import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import { ErroAcbrImpressora, PROTOCOL_VERSION, SOURCE_REVISION,
  type ComandoImpressao, type ConfiguracaoImpressora, type ConfiguracaoMotor, type CriaProcesso,
  type ConfiguracaoSerial, type ConfiguracaoLayoutSpooler, type EntradaXml, type OpcoesDanfe, type OpcoesOperacao, type ResultadoImpressao,
  type RuntimeManifest } from './types.js';

const INPUT_LIMIT = 2 * 1024 * 1024;
const RESPONSE_LIMIT = 32 * 1024 * 1024;
const TEARDOWN_MS = 1000;
const STATES = new Set(['PREPARADO', 'ENVIADO', 'GERADO', 'ERRO']);
const plain = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};
const fail = (code: string, message: string, uncertain = false) => new ErroAcbrImpressora(code, message, uncertain);
const physical = (command: ComandoImpressao) => command === 'imprimirTexto' || command === 'imprimirDanfe';
function keys(value: Record<string, unknown>, allowed: readonly string[], code: string) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw fail(code, 'Há campos desconhecidos na configuração ou operação.');
}
function integer(value: unknown, minimum: number, maximum: number, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw fail('CONFIGURACAO_INVALIDA', `O campo ${field} deve ser um inteiro entre ${minimum} e ${maximum}.`);
  }
  return value;
}
function destination(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > 1024 || /[\x00-\x1f\x7f]/u.test(value)) {
    throw fail('CONFIGURACAO_INVALIDA', `O campo ${field} deve identificar um destino válido.`);
  }
  return value.trim();
}
function confined(root: string, name: string): string {
  if (!name || name.length > 2048 || name.includes('\\') || path.isAbsolute(name) || name.split('/').includes('..')) {
    throw fail('RUNTIME_INVALIDO', 'Caminho inválido no manifesto do runtime.');
  }
  const file = path.resolve(root, name), relative = path.relative(root, file);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw fail('RUNTIME_INVALIDO', 'Caminho inválido no manifesto do runtime.');
  }
  return file;
}
interface Runtime { directory: string; executable: string }
async function resolveRuntime(directory?: string, requiredFeatures: readonly string[] = []): Promise<Runtime> {
  if (!['linux', 'win32'].includes(process.platform) || process.arch !== 'x64') {
    throw fail('PLATAFORMA_NAO_SUPORTADA', 'Esta versão suporta Linux e Windows x64.');
  }
  let root = directory;
  if (!root) {
    const entry = typeof __filename === 'string' ? __filename : fileURLToPath(import.meta.url);
    const require = createRequire(entry);
    try {
      root = path.join(path.dirname(require.resolve(`cosmemilton-acbr-printer-node-${process.platform}-x64/package.json`)), 'runtime');
    } catch {
      for (const candidate of [path.join(path.dirname(entry), '../runtime', `${process.platform}-x64`),
        path.join(path.dirname(entry), 'runtime', `${process.platform}-x64`)]) {
        try { if ((await lstat(path.join(candidate, 'manifest.json'))).isFile()) { root = candidate; break; } } catch { /* Try the next local runtime. */ }
      }
    }
    if (!root) throw fail('RUNTIME_AUSENTE', 'Instale um runtime de impressão ou informe runtimeDirectory.');
  }
  try { root = await realpath(root); } catch { throw fail('RUNTIME_AUSENTE', 'Diretório do runtime não encontrado.'); }
  let data: unknown;
  try { data = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')); }
  catch { throw fail('RUNTIME_AUSENTE', 'Manifesto do runtime não encontrado ou inválido.'); }
  if (!plain(data) || data.formatVersion !== 1 || data.sourceRevision !== SOURCE_REVISION || data.platform !== process.platform ||
    data.arch !== process.arch || typeof data.executable !== 'string' || !plain(data.files) ||
    !Object.hasOwn(data.files, data.executable) || Object.keys(data.files).length > 10000) {
    throw fail('RUNTIME_INVALIDO', 'Manifesto, revisão ACBr ou plataforma do runtime incompatíveis.');
  }
  const manifest = data as unknown as RuntimeManifest;
  if (requiredFeatures.some(feature => !Array.isArray(manifest.features) || !manifest.features.includes(feature))) {
    throw fail('RUNTIME_INCOMPATIVEL', 'O runtime não suporta os parâmetros de serial ou layout desta configuração. Atualize o runtime de impressão.');
  }
  for (const [name, hash] of Object.entries(manifest.files)) {
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw fail('RUNTIME_INVALIDO', 'Hash inválido no runtime.');
    const file = confined(root, name);
    let bytes: Buffer;
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink()) throw Error();
      bytes = await readFile(file);
    } catch { throw fail('RUNTIME_INCOMPLETO', 'Arquivo necessário ao runtime ausente ou inválido.'); }
    if (createHash('sha256').update(bytes).digest('hex') !== hash) throw fail('RUNTIME_ALTERADO', 'O runtime não corresponde aos hashes distribuídos.');
  }
  return { directory: root, executable: confined(root, manifest.executable) };
}
function base64(value: unknown, limit: number, code: string, allowEmpty = false): Buffer {
  if (typeof value !== 'string' || (!value && !allowEmpty) || value.length > Math.ceil(limit / 3) * 4 || value.length % 4 !== 0) {
    throw fail(code, 'Conteúdo Base64 inválido ou acima do limite.');
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length > limit || decoded.toString('base64') !== value) throw fail(code, 'Conteúdo Base64 inválido ou acima do limite.');
  return decoded;
}
interface Request {
  versao: 1; id: string; comando: ComandoImpressao; config: ConfiguracaoMotor;
  texto?: string; xmlBase64?: string; opcoes?: OpcoesDanfe;
}
interface Pending {
  request: Request; bytes: Buffer; signal?: AbortSignal; abort?: () => void;
  status: 'queued' | 'active'; stop?: (code: string, message: string) => void;
  resolve: (result: ResultadoImpressao) => void; reject: (error: unknown) => void;
  complete: Promise<void>; completed: () => void; run: () => Promise<void>;
}
interface DestinationQueue { active: boolean; items: Pending[] }
const queues = new Map<string, DestinationQueue>();
function destinationKey(config: ConfiguracaoMotor, unique: string): string {
  let target = config.modo === 'spooler' ? config.impressora : config.porta;
  if (!target) return `local:${unique}`;
  if (process.platform === 'win32') {
    target = target.replaceAll('/', '\\').toLowerCase();
    const unc = /^\\\\([^\\]+)\\([^\\]+)$/.exec(target);
    if (unc && ['localhost', '.', '127.0.0.1', process.env.COMPUTERNAME?.toLowerCase()].includes(unc[1]!)) target = unc[2]!;
  }
  return `${process.platform}:${target}`;
}
function drain(key: string, queue: DestinationQueue) {
  if (queue.active) return;
  const next = queue.items.shift();
  if (!next) { if (queues.get(key) === queue) queues.delete(key); return; }
  queue.active = true; next.status = 'active';
  void next.run().finally(() => { queue.active = false; drain(key, queue); });
}
function operationOptions(value: unknown): OpcoesOperacao {
  if (value === undefined) return {};
  if (!plain(value)) throw fail('OPERACAO_INVALIDA', 'Informe opções válidas para a operação.');
  keys(value, ['signal'], 'OPERACAO_INVALIDA');
  const signal = value.signal as AbortSignal | undefined;
  if (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function' ||
    typeof signal.removeEventListener !== 'function')) throw fail('OPERACAO_INVALIDA', 'O campo signal deve ser um AbortSignal.');
  return { signal };
}
function danfeOptions(value: unknown): OpcoesDanfe | undefined {
  if (value === undefined) return undefined;
  if (!plain(value)) throw fail('OPERACAO_INVALIDA', 'Informe opções válidas para o DANFE.');
  keys(value, ['copias', 'larguraPapel'], 'OPERACAO_INVALIDA');
  const result: OpcoesDanfe = {};
  if (value.copias !== undefined) {
    if (typeof value.copias !== 'number' || !Number.isInteger(value.copias) || value.copias < 1 || value.copias > 99) {
      throw fail('OPERACAO_INVALIDA', 'O número de cópias deve ser um inteiro entre 1 e 99.');
    }
    result.copias = value.copias;
  }
  if (value.larguraPapel !== undefined) {
    if (typeof value.larguraPapel !== 'number' || !Number.isFinite(value.larguraPapel) || value.larguraPapel < 40 || value.larguraPapel > 300) {
      throw fail('OPERACAO_INVALIDA', 'A largura do papel deve estar entre 40 e 300 milímetros.');
    }
    result.larguraPapel = value.larguraPapel;
  }
  return result;
}
function xmlData(value: EntradaXml): string {
  let bytes: Buffer;
  if (typeof value === 'string') bytes = Buffer.from(value, 'utf8');
  else if (value instanceof Uint8Array) bytes = Buffer.from(value);
  else if (plain(value)) bytes = base64(value.xmlBase64, INPUT_LIMIT, 'XML_INVALIDO');
  else throw fail('XML_INVALIDO', 'Informe o XML ou um objeto com xmlBase64.');
  if (!bytes.length || bytes.length > INPUT_LIMIT) throw fail('XML_INVALIDO', 'XML vazio ou acima do limite de 2 MiB.');
  try { if (!new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim()) throw Error(); }
  catch { throw fail('XML_INVALIDO', 'O XML deve conter texto UTF-8 válido.'); }
  return bytes.toString('base64');
}
function textData(value: unknown): string {
  if (typeof value !== 'string' || !value.length || Buffer.byteLength(value, 'utf8') > INPUT_LIMIT) {
    throw fail('TEXTO_INVALIDO', 'Informe texto não vazio com até 2 MiB.');
  }
  return value;
}

function decimal(value: unknown, minimum: number, maximum: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw fail('CONFIGURACAO_INVALIDA', `O campo ${field} deve estar entre ${minimum} e ${maximum}.`);
  }
  return value;
}
function serialOptions(value: unknown): Required<ConfiguracaoSerial> {
  if (!plain(value)) throw fail('CONFIGURACAO_INVALIDA', 'serial deve ser um objeto.');
  keys(value, ['velocidade', 'bitsDados', 'paridade', 'bitsParada', 'controleFluxo'], 'CONFIGURACAO_INVALIDA');
  const velocidade = integer(value.velocidade === undefined ? 9600 : value.velocidade, 300, 115200, 'serial.velocidade');
  const bitsDados = integer(value.bitsDados === undefined ? 8 : value.bitsDados, 5, 8, 'serial.bitsDados') as 5 | 6 | 7 | 8;
  const paridade = value.paridade === undefined ? 'nenhuma' : value.paridade;
  const bitsParada = value.bitsParada === undefined ? 1 : value.bitsParada;
  const controleFluxo = value.controleFluxo === undefined ? 'nenhum' : value.controleFluxo;
  if (!['nenhuma', 'impar', 'par', 'marca', 'espaco'].includes(String(paridade)) || typeof paridade !== 'string') throw fail('CONFIGURACAO_INVALIDA', 'serial.paridade inválida.');
  if (![1, 1.5, 2].includes(bitsParada as number)) throw fail('CONFIGURACAO_INVALIDA', 'serial.bitsParada deve ser 1, 1.5 ou 2.');
  if (!['nenhum', 'xon-xoff', 'rts-cts', 'dtr-dsr'].includes(String(controleFluxo)) || typeof controleFluxo !== 'string') throw fail('CONFIGURACAO_INVALIDA', 'serial.controleFluxo inválido.');
  return { velocidade, bitsDados, paridade: paridade as Required<ConfiguracaoSerial>['paridade'], bitsParada: bitsParada as 1 | 1.5 | 2, controleFluxo: controleFluxo as Required<ConfiguracaoSerial>['controleFluxo'] };
}
function layoutOptions(value: unknown): Required<ConfiguracaoLayoutSpooler> {
  if (!plain(value)) throw fail('CONFIGURACAO_INVALIDA', 'layout deve ser um objeto.');
  keys(value, ['larguraPapel', 'margemEsquerda', 'margemDireita', 'margemSuperior', 'margemInferior', 'escala'], 'CONFIGURACAO_INVALIDA');
  const normalized = {
    larguraPapel: decimal(value.larguraPapel === undefined ? 80 : value.larguraPapel, 40, 300, 'layout.larguraPapel'),
    margemEsquerda: decimal(value.margemEsquerda === undefined ? 3 : value.margemEsquerda, 0, 30, 'layout.margemEsquerda'),
    margemDireita: decimal(value.margemDireita === undefined ? 3 : value.margemDireita, 0, 30, 'layout.margemDireita'),
    margemSuperior: decimal(value.margemSuperior === undefined ? 3 : value.margemSuperior, 0, 30, 'layout.margemSuperior'),
    margemInferior: decimal(value.margemInferior === undefined ? 3 : value.margemInferior, 0, 30, 'layout.margemInferior'),
    escala: decimal(value.escala === undefined ? 100 : value.escala, 50, 200, 'layout.escala'),
  };
  if (normalized.larguraPapel - normalized.margemEsquerda - normalized.margemDireita < 10) throw fail('CONFIGURACAO_INVALIDA', 'As margens devem preservar pelo menos 10 mm de largura útil.');
  return normalized;
}

export function criarImpressora(options: ConfiguracaoImpressora = {}) {
  const rawOptions: unknown = options;
  if (!plain(rawOptions)) throw fail('CONFIGURACAO_INVALIDA', 'Informe a configuração como objeto.');
  keys(rawOptions, ['modo', 'porta', 'impressora', 'tipo', 'colunas', 'linhasEntreCupons', 'interpretarTags', 'cortarPapel', 'serial', 'layout', 'runtimeDirectory', 'timeoutMs', 'limiteFila', 'criaProcesso'], 'CONFIGURACAO_INVALIDA');
  const mode = options.modo === undefined ? 'escpos' : options.modo;
  const kind = options.tipo === undefined ? 0 : options.tipo;
  if (!['escpos', 'spooler'].includes(mode)) throw fail('CONFIGURACAO_INVALIDA', 'O modo deve ser escpos ou spooler.');
  if (kind !== 0 && kind !== 8) throw fail('CONFIGURACAO_INVALIDA', 'O tipo deve ser 0 (texto) ou 8 (ESC/POS Star).');
  if (options.interpretarTags !== undefined && typeof options.interpretarTags !== 'boolean') throw fail('CONFIGURACAO_INVALIDA', 'interpretarTags deve ser booleano.');
  if (options.cortarPapel !== undefined && typeof options.cortarPapel !== 'boolean') throw fail('CONFIGURACAO_INVALIDA', 'cortarPapel deve ser booleano.');
  if (options.runtimeDirectory !== undefined && (typeof options.runtimeDirectory !== 'string' || !options.runtimeDirectory.trim() || options.runtimeDirectory.includes('\0'))) {
    throw fail('CONFIGURACAO_INVALIDA', 'Informe um runtimeDirectory válido.');
  }
  if (options.criaProcesso !== undefined && typeof options.criaProcesso !== 'function') throw fail('CONFIGURACAO_INVALIDA', 'criaProcesso deve ser uma função de teste.');
  const config: ConfiguracaoMotor = { modo: mode, tipo: kind,
    colunas: integer(options.colunas === undefined ? 48 : options.colunas, 1, 200, 'colunas'),
    linhasEntreCupons: integer(options.linhasEntreCupons === undefined ? 0 : options.linhasEntreCupons, 0, 100, 'linhasEntreCupons'),
    interpretarTags: options.interpretarTags ?? false, cortarPapel: options.cortarPapel ?? false };
  if (options.serial !== undefined) config.serial = serialOptions(options.serial);
  if (options.layout !== undefined) config.layout = layoutOptions(options.layout);
  const requiredFeatures = [...(mode === 'escpos' && config.serial ? ['serial'] : []), ...(mode === 'spooler' && config.layout ? ['layout-spooler'] : [])];
  const port = destination(options.porta, 'porta'), printer = destination(options.impressora, 'impressora');
  if (port !== undefined) config.porta = port;
  if (printer !== undefined) config.impressora = printer;
  const timeout = integer(options.timeoutMs === undefined ? 30000 : options.timeoutMs, 1, 120000, 'timeoutMs');
  const capacity = integer(options.limiteFila === undefined ? 32 : options.limiteFila, 0, 1000, 'limiteFila');
  const runtimeDirectory = options.runtimeDirectory;
  const launch: CriaProcesso = options.criaProcesso ?? ((executable, args, spawnOptions) => spawn(executable, args, { ...spawnOptions, stdio: ['pipe', 'pipe', 'pipe'] }));
  const key = destinationKey(config, randomUUID());
  const owned = new Set<Pending>();
  let closed = false, cleanupFailed = false;
  let runtime: Promise<Runtime> | undefined;

  function requireDestination() {
    const target = config.modo === 'spooler' ? config.impressora : config.porta;
    if (!target) throw fail('DESTINO_AUSENTE', config.modo === 'spooler' ? 'Informe o nome da impressora do spooler.' : 'Informe a porta da impressora POS.');
    if (process.platform !== 'win32' && /^[\\/]{2}/u.test(target)) {
      throw fail('DESTINO_WINDOWS_REQUER_NODE_WINDOWS', 'Compartilhamentos Windows como \\\\localhost\\elgin exigem Node.js e o runtime de impressão executados no Windows.');
    }
  }
  function resultFromFrame(frame: Record<string, unknown>, item: Pending, sending: boolean): ResultadoImpressao {
    if (frame.versao !== PROTOCOL_VERSION || frame.sourceRevision !== SOURCE_REVISION || typeof frame.sucesso !== 'boolean' ||
      !STATES.has(String(frame.estado)) || typeof frame.envioIniciado !== 'boolean' || (sending && !frame.envioIniciado) ||
      (frame.resultadoIncerto !== undefined && typeof frame.resultadoIncerto !== 'boolean') ||
      (frame.codigo !== undefined && (typeof frame.codigo !== 'string' || frame.codigo.length > 128)) ||
      (frame.mensagem !== undefined && (typeof frame.mensagem !== 'string' || frame.mensagem.length > 8192))) throw Error();
    if (frame.sucesso && (frame.estado === 'ERRO' || frame.resultadoIncerto === true) || !frame.sucesso && frame.estado !== 'ERRO') throw Error();
    const command = item.request.comando;
    if (!physical(command) && (sending || frame.envioIniciado || frame.estado === 'ENVIADO')) throw Error();
    if (frame.sucesso && physical(command) && (frame.estado !== 'ENVIADO' || !frame.envioIniciado)) throw Error();
    const result: ResultadoImpressao = { versao: 1, id: item.request.id, sourceRevision: SOURCE_REVISION,
      sucesso: frame.sucesso, estado: frame.estado as ResultadoImpressao['estado'], envioIniciado: sending || frame.envioIniciado };
    if (typeof frame.codigo === 'string') result.codigo = frame.codigo;
    if (typeof frame.mensagem === 'string') result.mensagem = frame.mensagem;
    if (frame.resultadoIncerto === true || !result.sucesso && result.envioIniciado) result.resultadoIncerto = true;
    if (frame.dadosBase64 !== undefined) { result.dados = base64(frame.dadosBase64, RESPONSE_LIMIT, 'RESPOSTA_INVALIDA', true); result.dadosBase64 = frame.dadosBase64 as string; }
    if (frame.pdfBase64 !== undefined) { result.pdf = base64(frame.pdfBase64, RESPONSE_LIMIT, 'RESPOSTA_INVALIDA'); result.pdfBase64 = frame.pdfBase64 as string; }
    if (frame.impressoras !== undefined) {
      if (!Array.isArray(frame.impressoras) || frame.impressoras.length > 10000 || frame.impressoras.some(value => typeof value !== 'string' || value.length > 1024 || value.includes('\0'))) throw Error();
      result.impressoras = frame.impressoras as string[];
    }
    if (frame.capacidades !== undefined) { if (!plain(frame.capacidades)) throw Error(); result.capacidades = frame.capacidades; }
    if (result.sucesso && (command === 'gerarEscpos' && result.dados === undefined || command === 'danfePdf' && result.pdf === undefined ||
      command === 'listarImpressoras' && result.impressoras === undefined || command === 'capacidades' && result.capacidades === undefined)) throw Error();
    return result;
  }
  function execute(item: Pending): Promise<ResultadoImpressao> {
    return new Promise((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams | undefined;
      let finished = false, started = false, requestWritten = false, sending = false;
      let total = 0, stderrBytes = 0, rest = Buffer.alloc(0), response: ResultadoImpressao | undefined;
      let stopError: ErroAcbrImpressora | undefined, teardownTimer: ReturnType<typeof setTimeout> | undefined;
      const uncertain = () => physical(item.request.comando) && (sending || started && requestWritten);
      const finish = (error?: unknown) => {
        if (finished) return; finished = true; clearTimeout(timer); clearTimeout(teardownTimer);
        item.signal?.removeEventListener('abort', item.abort!); item.bytes.fill(0); item.stop = undefined;
        error ? reject(error) : resolve(response!);
      };
      const detach = () => {
        for (const pipe of [child?.stdin, child?.stdout, child?.stderr]) {
          try { pipe?.destroy(); } catch { /* The owned stream may already be closed. */ }
          try { (pipe as { unref?: () => void } | undefined)?.unref?.(); } catch { /* No borrowed handles. */ }
        }
        try { child?.unref(); } catch { /* Only the process created by this instance. */ }
      };
      const fallback = () => {
        if (finished) return;
        stopError ??= fail('FALHA_ENCERRAR_MOTOR', 'Não foi possível confirmar o encerramento do motor.', uncertain());
        stopError.falhaLimpeza = true; cleanupFailed = true; closed = true;
        finish(stopError); detach(); rejectOwnedQueue();
      };
      const stop = (code: string, message: string) => {
        if (finished || stopError) return;
        stopError = fail(code, message, uncertain());
        if (!child?.pid) { finish(stopError); detach(); return; }
        teardownTimer = setTimeout(fallback, TEARDOWN_MS);
        try { if (child.kill('SIGKILL') !== true) fallback(); } catch { fallback(); }
      };
      item.stop = stop;
      const timer = setTimeout(() => stop('TIMEOUT_MOTOR', 'O motor de impressão excedeu o prazo. Confira o destino antes de repetir o envio.'), timeout);
      if (closed || item.signal?.aborted) { stop('OPERACAO_CANCELADA', 'Operação cancelada antes da execução.'); return; }
      void (runtime ??= resolveRuntime(runtimeDirectory, requiredFeatures)).then(resolved => {
        if (finished || stopError) return;
        if (closed || item.signal?.aborted) { stop('OPERACAO_CANCELADA', 'Operação cancelada antes da execução.'); return; }
        const env: NodeJS.ProcessEnv = {};
        for (const name of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'LANG', 'LC_ALL', 'DISPLAY', 'XDG_RUNTIME_DIR']) {
          if (process.env[name] !== undefined) env[name] = process.env[name];
        }
        if (process.platform === 'linux') env.LD_LIBRARY_PATH = path.join(resolved.directory, 'lib');
        if (process.platform === 'win32') { const inherited = env.Path ?? env.PATH ?? ''; delete env.Path; env.PATH = path.join(resolved.directory, 'lib') + ';' + resolved.directory + ';' + inherited; }
        try { child = launch(resolved.executable, [], { cwd: resolved.directory, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); started = typeof child.pid === 'number'; }
        catch { finish(fail('FALHA_INICIAR_MOTOR', 'Não foi possível iniciar o motor de impressão.')); return; }
        child.on('spawn', () => { started = true; });
        child.on('error', () => { if (stopError) fallback(); else stop('FALHA_INICIAR_MOTOR', 'Não foi possível iniciar o motor de impressão.'); });
        for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on('error', () => stop('FALHA_PIPE', 'Falha na comunicação com o motor de impressão.'));
        child.stderr.on('data', (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > 1024 * 1024) stop('RESPOSTA_EXCESSIVA', 'O motor excedeu o limite de diagnóstico.'); });
        child.stdout.on('data', (chunk: Buffer) => {
          if (finished || stopError) return;
          total += chunk.length;
          if (total > RESPONSE_LIMIT) { stop('RESPOSTA_EXCESSIVA', 'Resposta do motor acima do limite.'); return; }
          rest = Buffer.concat([rest, chunk]);
          let end: number;
          while ((end = rest.indexOf(10)) >= 0) {
            const line = rest.subarray(0, end); rest = rest.subarray(end + 1);
            if (!line.length) continue;
            try {
              const frame: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
              if (!plain(frame) || frame.id !== item.request.id) throw Error();
              if (frame.tipo === 'envioIniciado') {
                if (response || !physical(item.request.comando)) throw Error(); sending = true; continue;
              }
              if (response) throw Error();
              response = resultFromFrame(frame, item, sending);
            } catch { stop('RESPOSTA_INVALIDA', 'O motor retornou uma resposta de impressão inválida.'); return; }
          }
        });
        child.on('close', code => {
          if (finished) return;
          if (stopError) { finish(stopError); return; }
          if (code !== 0 || rest.length || !response) { finish(fail('FALHA_MOTOR', 'O motor encerrou sem uma resposta válida.', uncertain())); return; }
          finish();
        });
        try { requestWritten = true; child.stdin.end(item.bytes); }
        catch { stop('FALHA_PIPE', 'Falha na comunicação com o motor de impressão.'); }
        if (item.signal?.aborted) stop('OPERACAO_CANCELADA', 'Operação cancelada. Confira o destino antes de repetir o envio.');
      }, error => { if (!finished) finish(error); });
    });
  }
  function closedError() {
    const error = fail('IMPRESSORA_FECHADA', 'A instância da impressora foi encerrada.');
    error.falhaLimpeza = cleanupFailed; return error;
  }
  function rejectOwnedQueue() {
    const queue = queues.get(key);
    if (!queue) return;
    for (const item of [...owned]) {
      if (item.status !== 'queued') continue;
      const index = queue.items.indexOf(item);
      if (index >= 0) queue.items.splice(index, 1);
      item.signal?.removeEventListener('abort', item.abort!); item.bytes.fill(0); owned.delete(item);
      item.reject(closedError()); item.completed();
    }
    if (!queue.active && !queue.items.length && queues.get(key) === queue) queues.delete(key);
  }
  async function request(command: ComandoImpressao, data: Partial<Request>, rawOperation?: OpcoesOperacao): Promise<ResultadoImpressao> {
    const operation = operationOptions(rawOperation);
    if (closed) throw closedError();
    if (operation.signal?.aborted) throw fail('OPERACAO_CANCELADA', 'Operação cancelada antes da execução.');
    if (physical(command)) requireDestination();
    const frame: Request = { versao: PROTOCOL_VERSION, id: randomUUID(), comando: command, config: { ...config }, ...data };
    const bytes = Buffer.from(JSON.stringify(frame) + '\n', 'utf8');
    return new Promise((resolve, reject) => {
      let queue = queues.get(key);
      if (!queue) { queue = { active: false, items: [] }; queues.set(key, queue); }
      if ((queue.active || queue.items.length > 0) && [...owned].filter(item => item.status === 'queued').length >= capacity) {
        bytes.fill(0); reject(fail('FILA_CHEIA', 'A fila desta impressora está cheia.')); return;
      }
      let completed!: () => void;
      const complete = new Promise<void>(done => { completed = done; });
      const item: Pending = { request: frame, bytes, signal: operation.signal, resolve, reject, status: 'queued', complete, completed,
        run: async () => {
          try { item.resolve(await execute(item)); }
          catch (error) { item.reject(error); }
          finally { item.signal?.removeEventListener('abort', item.abort!); item.bytes.fill(0); owned.delete(item); item.completed(); }
        } };
      item.abort = () => {
        if (item.status === 'active') { item.stop?.('OPERACAO_CANCELADA', 'Operação cancelada. Confira o destino antes de repetir o envio.'); return; }
        const index = queue!.items.indexOf(item);
        if (index < 0) return;
        queue!.items.splice(index, 1); owned.delete(item); item.bytes.fill(0);
        item.signal?.removeEventListener('abort', item.abort!); item.reject(fail('OPERACAO_CANCELADA', 'Operação cancelada antes da execução.')); item.completed();
        if (!queue!.active && !queue!.items.length && queues.get(key) === queue) queues.delete(key);
      };
      owned.add(item); queue.items.push(item); operation.signal?.addEventListener('abort', item.abort, { once: true });
      if (operation.signal?.aborted) item.abort();
      drain(key, queue);
    });
  }
  return {
    async gerarEscpos(texto: string, operacao?: OpcoesOperacao) { return request('gerarEscpos', { texto: textData(texto) }, operacao); },
    async imprimirTexto(texto: string, operacao?: OpcoesOperacao) { return request('imprimirTexto', { texto: textData(texto) }, operacao); },
    async listarImpressoras(operacao?: OpcoesOperacao) { return request('listarImpressoras', {}, operacao); },
    async capacidades(operacao?: OpcoesOperacao) { return request('capacidades', {}, operacao); },
    async danfePdf(xml: EntradaXml, opcoes?: OpcoesDanfe, operacao?: OpcoesOperacao) {
      return request('danfePdf', { xmlBase64: xmlData(xml), opcoes: danfeOptions(opcoes) }, operacao);
    },
    async imprimirDanfe(xml: EntradaXml, opcoes?: OpcoesDanfe, operacao?: OpcoesOperacao) {
      return request('imprimirDanfe', { xmlBase64: xmlData(xml), opcoes: danfeOptions(opcoes) }, operacao);
    },
    async fechar() {
      closed = true; rejectOwnedQueue();
      const current = [...owned].filter(item => item.status === 'active');
      for (const item of current) item.stop?.('IMPRESSORA_FECHADA', 'A instância da impressora foi encerrada.');
      await Promise.all(current.map(item => item.complete));
    },
  };
}
export type Impressora = ReturnType<typeof criarImpressora>;
