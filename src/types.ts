import type { Buffer } from 'node:buffer';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';

export const PROTOCOL_VERSION = 1 as const;
export const SOURCE_REVISION = 48590 as const;
export const TIPOS_IMPRESSORA = { Texto: 0, EscPosStar: 8 } as const;
export type TipoImpressora = typeof TIPOS_IMPRESSORA[keyof typeof TIPOS_IMPRESSORA];
export type ModoImpressao = 'escpos' | 'spooler';
export type ComandoImpressao = 'capacidades' | 'listarImpressoras' | 'gerarEscpos' | 'imprimirTexto' | 'danfePdf' | 'imprimirDanfe';
export type EstadoImpressao = 'PREPARADO' | 'ENVIADO' | 'GERADO' | 'ERRO';

export type CriaProcesso = (executavel: string, argumentos: string[], opcoes: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
export interface ConfiguracaoImpressora {
  modo?: ModoImpressao;
  /** Destino POS. No Windows, por exemplo String.raw`\\localhost\elgin`. */
  porta?: string;
  /** Nome da fila instalada no sistema, por exemplo elgin. */
  impressora?: string;
  /** Linguagem ACBrPosPrinter: 0 = texto; 8 = ESC/POS Star. */
  tipo?: TipoImpressora;
  colunas?: number;
  linhasEntreCupons?: number;
  interpretarTags?: boolean;
  /** Permite tags de corte; permanece desativado até autorização explícita. */
  cortarPapel?: boolean;
  runtimeDirectory?: string;
  timeoutMs?: number;
  limiteFila?: number;
  /** Injeção de processo exclusivamente para testes sem hardware. */
  criaProcesso?: CriaProcesso;
}
export interface ConfiguracaoMotor {
  modo: ModoImpressao;
  porta?: string;
  impressora?: string;
  tipo: TipoImpressora;
  colunas: number;
  linhasEntreCupons: number;
  interpretarTags: boolean;
  cortarPapel: boolean;
}
export interface OpcoesOperacao { signal?: AbortSignal }
export interface OpcoesDanfe { copias?: number; larguraPapel?: number }
/** Recebe também ResultadoFiscal do emissor sem uma dependência do pacote fiscal. */
export type EntradaXml = string | Uint8Array | { xmlBase64?: string | null };
export interface ResultadoImpressao {
  versao: 1;
  id: string;
  sourceRevision: 48590;
  sucesso: boolean;
  estado: EstadoImpressao;
  envioIniciado: boolean;
  codigo?: string;
  mensagem?: string;
  /** Há possibilidade de envio ao dispositivo. Não repetir automaticamente. */
  resultadoIncerto?: boolean;
  dadosBase64?: string;
  pdfBase64?: string;
  dados?: Buffer;
  pdf?: Buffer;
  impressoras?: string[];
  capacidades?: Record<string, unknown>;
}
export interface RuntimeManifest {
  formatVersion: 1;
  sourceRevision: 48590;
  platform: string;
  arch: string;
  executable: string;
  files: Record<string, string>;
}
export class ErroAcbrImpressora extends Error {
  override readonly name = 'ErroAcbrImpressora';
  falhaLimpeza = false;
  constructor(readonly codigo: string, mensagem: string, readonly resultadoIncerto = false) { super(mensagem); }
  toJSON() {
    return { codigo: this.codigo, mensagem: this.message, resultadoIncerto: this.resultadoIncerto,
      ...(this.falhaLimpeza ? { falhaLimpeza: true } : {}) };
  }
}
