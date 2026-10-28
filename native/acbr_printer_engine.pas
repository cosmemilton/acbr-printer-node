unit acbr_printer_engine;

{$mode objfpc}{$H+}{$codepage utf8}

interface

uses
  Classes, SysUtils, fpjson;

const
  PrinterProtocolVersion = 1;
  ACBrSourceRevision = 48590;

function ExecutePrinterRequest(ARequest: TJSONObject): TJSONObject;
function PrinterProtocolError(const AMessage: string): TJSONObject;

implementation

uses
  Math, base64, LazUTF8, Printers, ACBrPosPrinter
  {$IFDEF ACBR_PRINTER_FORTES}
  , RLReport, RLPrinters, RLTypes
  {$ENDIF}
  {$IFDEF ACBR_PRINTER_NFE}
  , DOM, XMLRead, ACBrNFe, ACBrNFeDANFeESCPOS, ACBrDFeDANFeReport, pcnConversao
    {$IFDEF ACBR_PRINTER_FORTES}
    , ACBrNFeDANFeRLClass, ACBrDANFCeFortesFr
    {$ENDIF}
  {$ENDIF};

const
  MaximumTextBytes = 2 * 1024 * 1024;
  MaximumXMLBytes = 2 * 1024 * 1024;

type
  EPrinterRequest = class(Exception)
  public
    Code: string;
    constructor Create(const ACode, AMessage: string);
  end;

  TPrinterOperation = class
  private
    FRequest: TJSONObject;
    FReply: TJSONObject;
    FID, FCommand, FMode, FPort, FPrinter: string;
    FModel, FColumns, FBetweenReceipts, FCopies: Integer;
    FPaperWidth: Double;
    FInterpretTags, FCutEnabled, FSendStarted: Boolean;
    procedure ReadConfiguration;
    procedure BeginPhysicalSend;
    procedure Finish(const AState, AMessage: string);
    function NewPOSPrinter(const APort: string): TACBrPosPrinter;
    function ReadText: string;
    procedure RequireInstalledPrinter;
    procedure Capabilities;
    procedure ListPrinters;
    procedure GenerateEscpos;
    procedure PrintText;
    procedure PrintTextSpooler(const AText: string);
    procedure Danfe(const AGeneratePDF: Boolean);
  public
    constructor Create(ARequest: TJSONObject);
    destructor Destroy; override;
    function Execute: TJSONObject;
  end;

function ProtocolMessageUTF8(const AMessage: string): string;
begin
  Result := AMessage;
  if (Result = '') or
     (FindInvalidUTF8Character(PChar(Result), Length(Result), True) < 0) then Exit;
  // Our literals and most LCL messages are already UTF-8. Only convert when
  // the bytes are invalid; otherwise accented messages would be encoded twice.
  {$IFDEF MSWINDOWS}
  // SysToUTF8 is a no-op with UTF8_RTL. WinCPToUTF8 explicitly uses CP_ACP
  // for legacy exception messages originating in third-party Windows units.
  Result := WinCPToUTF8(Result);
  {$ELSE}
  Result := SysToUTF8(Result);
  {$ENDIF}
  if FindInvalidUTF8Character(PChar(Result), Length(Result), True) >= 0 then
    UTF8FixBroken(Result);
end;

constructor EPrinterRequest.Create(const ACode, AMessage: string);
begin
  inherited Create(AMessage);
  Code := ACode;
end;

function OptionalObject(AObject: TJSONObject; const AName: string): TJSONObject;
var
  Value: TJSONData;
begin
  Result := nil;
  Value := AObject.Find(AName);
  if not Assigned(Value) then Exit;
  if Value.JSONType <> jtObject then
    raise EPrinterRequest.Create('CONFIGURACAO_INVALIDA', AName + ' deve ser um objeto.');
  Result := TJSONObject(Value);
end;

function StringValue(AObject: TJSONObject; const AName, ADefault: string): string;
var
  Value: TJSONData;
begin
  Result := ADefault;
  if not Assigned(AObject) then Exit;
  Value := AObject.Find(AName);
  if not Assigned(Value) then Exit;
  if Value.JSONType <> jtString then
    raise EPrinterRequest.Create('CONFIGURACAO_INVALIDA', AName + ' deve ser uma string.');
  Result := Value.AsString;
end;

function IntegerValue(AObject: TJSONObject; const AName: string;
  ADefault, AMinimum, AMaximum: Integer): Integer;
var
  Value: TJSONData;
  Number: Int64;
begin
  Result := ADefault;
  if not Assigned(AObject) then Exit;
  Value := AObject.Find(AName);
  if not Assigned(Value) then Exit;
  if (Value.JSONType <> jtNumber) or
    not TryStrToInt64(Value.AsJSON, Number) then
    raise EPrinterRequest.Create('CONFIGURACAO_INVALIDA', AName + ' deve ser um inteiro.');
  if (Number < AMinimum) or (Number > AMaximum) then
    raise EPrinterRequest.Create('CONFIGURACAO_INVALIDA', AName + ' fora do intervalo permitido.');
  Result := Number;
end;

function BooleanValue(AObject: TJSONObject; const AName: string; ADefault: Boolean): Boolean;
var
  Value: TJSONData;
begin
  Result := ADefault;
  if not Assigned(AObject) then Exit;
  Value := AObject.Find(AName);
  if not Assigned(Value) then Exit;
  if Value.JSONType <> jtBoolean then
    raise EPrinterRequest.Create('CONFIGURACAO_INVALIDA', AName + ' deve ser booleano.');
  Result := Value.AsBoolean;
end;

function NumberValue(AObject: TJSONObject; const AName: string;
  ADefault, AMinimum, AMaximum: Double): Double;
var
  Value: TJSONData;
begin
  Result := ADefault;
  if not Assigned(AObject) then Exit;
  Value := AObject.Find(AName);
  if not Assigned(Value) then Exit;
  if Value.JSONType <> jtNumber then
    raise EPrinterRequest.Create('CONFIGURACAO_INVALIDA', AName + ' deve ser numérico.');
  Result := Value.AsFloat;
  if IsNan(Result) or IsInfinite(Result) or (Result < AMinimum) or (Result > AMaximum) then
    raise EPrinterRequest.Create('CONFIGURACAO_INVALIDA', AName + ' fora do intervalo permitido.');
end;

function StreamBase64(AStream: TStream): string;
var
  Bytes: RawByteString;
begin
  AStream.Position := 0;
  SetLength(Bytes, AStream.Size);
  if Length(Bytes) > 0 then AStream.ReadBuffer(Bytes[1], Length(Bytes));
  Result := EncodeStringBase64(Bytes);
end;

function FileBase64(const AFile: string): string;
var
  Stream: TFileStream;
begin
  Stream := TFileStream.Create(AFile, fmOpenRead or fmShareDenyWrite);
  try
    Result := StreamBase64(Stream);
  finally
    Stream.Free;
  end;
end;

function BaseReply(const AID: string): TJSONObject;
begin
  Result := TJSONObject.Create;
  Result.Add('versao', PrinterProtocolVersion);
  Result.Add('id', AID);
  Result.Add('sourceRevision', ACBrSourceRevision);
  Result.Add('sucesso', False);
  Result.Add('estado', 'ERRO');
  Result.Add('envioIniciado', False);
end;

function PrinterProtocolError(const AMessage: string): TJSONObject;
begin
  Result := BaseReply('');
  Result.Add('codigo', 'PROTOCOLO_INVALIDO');
  Result.Add('mensagem', ProtocolMessageUTF8(AMessage));
  Result.Add('resultadoIncerto', False);
end;

constructor TPrinterOperation.Create(ARequest: TJSONObject);
begin
  inherited Create;
  FRequest := ARequest;
  FID := StringValue(ARequest, 'id', '');
  FReply := BaseReply(FID);
end;

destructor TPrinterOperation.Destroy;
begin
  FReply.Free;
  inherited Destroy;
end;

procedure TPrinterOperation.ReadConfiguration;
var
  Config, Options: TJSONObject;
begin
  if IntegerValue(FRequest, 'versao', 0, 0, MaxInt) <> PrinterProtocolVersion then
    raise EPrinterRequest.Create('PROTOCOLO_INVALIDO', 'Versão de protocolo não suportada.');
  if (FID = '') or (Length(FID) > 128) then
    raise EPrinterRequest.Create('PROTOCOLO_INVALIDO', 'id deve conter de 1 a 128 caracteres.');
  FCommand := StringValue(FRequest, 'comando', '');
  Config := OptionalObject(FRequest, 'config');
  Options := OptionalObject(FRequest, 'opcoes');
  FMode := StringValue(Config, 'modo', 'escpos');
  if (FMode <> 'escpos') and (FMode <> 'spooler') then
    raise EPrinterRequest.Create('CONFIGURACAO_INVALIDA', 'modo deve ser escpos ou spooler.');
  FModel := IntegerValue(Config, 'tipo', 0, 0, 8);
  if not (FModel in [0, 8]) then
    raise EPrinterRequest.Create('CONFIGURACAO_INVALIDA', 'tipo deve ser 0 (texto) ou 8 (EscPosStar).');
  FColumns := IntegerValue(Config, 'colunas', 48, 1, 200);
  FBetweenReceipts := IntegerValue(Config, 'linhasEntreCupons', 0, 0, 100);
  FInterpretTags := BooleanValue(Config, 'interpretarTags', False);
  FCutEnabled := BooleanValue(Config, 'cortarPapel', False);
  FPort := StringValue(Config, 'porta', '');
  FPrinter := StringValue(Config, 'impressora', '');
  if (Pos(#0, FPort) > 0) or (Pos(#0, FPrinter) > 0) then
    raise EPrinterRequest.Create('CONFIGURACAO_INVALIDA', 'Destino de impressão inválido.');
  FCopies := IntegerValue(Options, 'copias', 1, 1, 99);
  FPaperWidth := NumberValue(Options, 'larguraPapel', 80, 40, 300);
  if (Ord(ppTexto) <> 0) or (Ord(ppEscPosStar) <> 8) then
    raise EPrinterRequest.Create('ACBR_INCOMPATIVEL', 'A enumeração do ACBr difere da revisão suportada.');
end;

procedure TPrinterOperation.BeginPhysicalSend;
var
  Marker: TJSONObject;
begin
  if FSendStarted then Exit;
  Marker := TJSONObject.Create;
  try
    Marker.Add('tipo', 'envioIniciado');
    Marker.Add('id', FID);
    WriteLn(Output, Marker.AsJSON);
    Flush(Output);
    FSendStarted := True;
    FReply.Booleans['envioIniciado'] := True;
  finally
    Marker.Free;
  end;
end;

procedure TPrinterOperation.Finish(const AState, AMessage: string);
begin
  FReply.Booleans['sucesso'] := True;
  FReply.Strings['estado'] := AState;
  FReply.Add('mensagem', AMessage);
end;

function TPrinterOperation.NewPOSPrinter(const APort: string): TACBrPosPrinter;
begin
  Result := TACBrPosPrinter.Create(nil);
  try
    Result.Modelo := TACBrPosPrinterModelo(FModel);
    Result.Porta := APort;
    Result.ColunasFonteNormal := FColumns;
    Result.LinhasEntreCupons := FBetweenReceipts;
    Result.CortaPapel := FCutEnabled;
    // Texto puro não injeta seleção de página de código nem interpreta tags.
    if FModel = 0 then Result.PaginaDeCodigo := pcNone;
  except
    Result.Free;
    raise;
  end;
end;

function TPrinterOperation.ReadText: string;
var
  C: Char;
begin
  Result := StringValue(FRequest, 'texto', '');
  if (Result = '') or (Length(Result) > MaximumTextBytes) then
    raise EPrinterRequest.Create('TEXTO_INVALIDO', 'texto deve conter de 1 byte a 2 MiB.');
  for C in Result do
    if (Ord(C) < 32) and not (C in [#9, #10, #13]) then
      raise EPrinterRequest.Create('TEXTO_INVALIDO', 'Comandos binários não são aceitos em texto. Use tags explícitas.');
end;

procedure TPrinterOperation.RequireInstalledPrinter;
var
  I: Integer;
begin
  if Trim(FPrinter) = '' then
    raise EPrinterRequest.Create('CONFIGURACAO_INVALIDA', 'impressora é obrigatória para o spooler.');
  for I := 0 to Printer.Printers.Count - 1 do
    if UTF8CompareText(Printer.Printers[I], FPrinter) = 0 then
    begin
      // O spooler aceita nome sem diferenciar caixa; Fortes recebe o nome canônico.
      FPrinter := Printer.Printers[I];
      Exit;
    end;
  raise EPrinterRequest.Create('IMPRESSORA_NAO_ENCONTRADA', 'Impressora não encontrada: ' + FPrinter);
end;

procedure TPrinterOperation.Capabilities;
var
  Data: TJSONObject;
  Models, Commands: TJSONArray;
begin
  Data := TJSONObject.Create;
  Data.Add('escpos', True);
  Data.Add('cortePapelOptIn', True);
  {$IFDEF ACBR_PRINTER_FORTES}
  Data.Add('spoolerFortes', True);
  {$ELSE}
  Data.Add('spoolerFortes', False);
  {$ENDIF}
  {$IFDEF ACBR_PRINTER_NFE}
  Data.Add('danfeEscpos', True);
    {$IFDEF ACBR_PRINTER_FORTES}
    Data.Add('danfeFortes', True);
    Data.Add('danfePdf', True);
    {$ELSE}
    Data.Add('danfeFortes', False);
    Data.Add('danfePdf', False);
    {$ENDIF}
  {$ELSE}
  Data.Add('danfeEscpos', False);
  Data.Add('danfeFortes', False);
  Data.Add('danfePdf', False);
  {$ENDIF}
  Models := TJSONArray.Create;
  Models.Add(0);
  Models.Add(8);
  Data.Add('tipos', Models);
  Data.Add('tipoPadrao', 0);
  Data.Add('tipo8', 'ppEscPosStar');
  Data.Add('confirmacaoFisica', False);
  Commands := TJSONArray.Create;
  Commands.Add('capacidades');
  Commands.Add('listarImpressoras');
  Commands.Add('gerarEscpos');
  Commands.Add('imprimirTexto');
  {$IFDEF ACBR_PRINTER_NFE}
  Commands.Add('imprimirDanfe');
    {$IFDEF ACBR_PRINTER_FORTES}
    Commands.Add('danfePdf');
    {$ENDIF}
  {$ENDIF}
  Data.Add('comandos', Commands);
  FReply.Add('capacidades', Data);
  Finish('PREPARADO', 'Capacidades do worker compilado.');
end;

procedure TPrinterOperation.ListPrinters;
var
  Names: TJSONArray;
  I: Integer;
begin
  Names := TJSONArray.Create;
  FReply.Add('impressoras', Names);
  for I := 0 to Printer.Printers.Count - 1 do Names.Add(Printer.Printers[I]);
  Finish('PREPARADO', 'Impressoras disponíveis para o usuário do processo.');
end;

procedure TPrinterOperation.GenerateEscpos;
var
  POS: TACBrPosPrinter;
  TempFile, Text: string;
begin
  if FMode <> 'escpos' then
    raise EPrinterRequest.Create('MODO_INCOMPATIVEL', 'gerarEscpos requer modo escpos.');
  Text := ReadText;
  TempFile := GetTempFileName(GetTempDir(False), 'acbp');
  try
    POS := NewPOSPrinter('FILE:' + TempFile);
    try
      POS.Ativar;
      POS.Imprimir(Text, False, FInterpretTags, FModel <> 0, FCopies);
      POS.Desativar;
    finally
      POS.Free;
    end;
    FReply.Add('dadosBase64', FileBase64(TempFile));
    Finish('GERADO', 'Bytes gerados pelo ACBr; nenhum destino físico foi acessado.');
  finally
    if FileExists(TempFile) then DeleteFile(TempFile);
  end;
end;

procedure TPrinterOperation.PrintText;
var
  POS: TACBrPosPrinter;
  Text: string;
begin
  Text := ReadText;
  if FMode = 'spooler' then
  begin
    PrintTextSpooler(Text);
    Exit;
  end;
  if Trim(FPort) = '' then
    raise EPrinterRequest.Create('CONFIGURACAO_INVALIDA', 'porta é obrigatória para escpos.');
  POS := NewPOSPrinter(FPort);
  try
    // Ativar pode inicializar o equipamento: o marcador antecede a abertura.
    BeginPhysicalSend;
    POS.Ativar;
    POS.Imprimir(Text, False, FInterpretTags, FModel <> 0, FCopies);
    POS.Desativar;
    Finish('ENVIADO', 'Dados enviados ao destino; a saída física não foi confirmada.');
  finally
    POS.Free;
  end;
end;

procedure TPrinterOperation.PrintTextSpooler(const AText: string);
{$IFDEF ACBR_PRINTER_FORTES}
var
  Report: TRLReport;
  Band: TRLBand;
  Memo: TRLMemo;
  Lines, SourceLines: TStringList;
  HeightMM: Double;
  I, Offset, WrapColumns: Integer;
  Line: string;
begin
  RequireInstalledPrinter;
  Report := TRLReport.Create(nil);
  Lines := TStringList.Create;
  SourceLines := TStringList.Create;
  try
    // Não calcular altura só pelas quebras recebidas: texto longo é quebrado sem
    // perder caracteres e sem deixar o memo menor que as linhas renderizadas.
    WrapColumns := Max(1, Min(FColumns, Floor((FPaperWidth - 6) * 72 / (25.4 * 0.6 * 9))));
    SourceLines.Text := AText;
    for I := 0 to SourceLines.Count - 1 do
    begin
      Line := StringReplace(SourceLines[I], #9, '    ', [rfReplaceAll]);
      if Line = '' then Lines.Add('');
      Offset := 1;
      while Offset <= UTF8Length(Line) do
      begin
        Lines.Add(UTF8Copy(Line, Offset, WrapColumns));
        Inc(Offset, WrapColumns);
      end;
    end;
    HeightMM := Max(30.0, (Lines.Count + 2) * 5.0);
    Report.ShowProgress := False;
    Report.PrintDialog := False;
    Report.PrintEmpty := True;
    Report.PageSetup.PaperSize := fpCustom;
    Report.PageSetup.PaperWidth := FPaperWidth;
    Report.PageSetup.PaperHeight := HeightMM;
    Report.Margins.LeftMargin := 3;
    Report.Margins.RightMargin := 3;
    Report.Margins.TopMargin := 3;
    Report.Margins.BottomMargin := 3;
    Band := TRLBand.Create(Report);
    Band.Parent := Report;
    Band.BandType := btTitle;
    Band.AutoExpand := True;
    Band.Height := Round((HeightMM - 6) * 96 / 25.4);
    Memo := TRLMemo.Create(Band);
    Memo.Parent := Band;
    Memo.Left := 0;
    Memo.Top := 0;
    Memo.Width := Round((FPaperWidth - 6) * 96 / 25.4);
    Memo.Height := Band.Height;
    Memo.AutoSize := True;
    Memo.WordWrap := False;
    Memo.Font.Name := 'Courier New';
    Memo.Font.Size := 9;
    Memo.Lines.Assign(Lines);
    RLPrinter.PrinterName := FPrinter;
    RLPrinter.Copies := FCopies;
    if not Report.Prepare then
      raise EPrinterRequest.Create('RELATORIO_INVALIDO', 'Não foi possível preparar o relatório.');
    BeginPhysicalSend;
    Report.Print;
    Finish('ENVIADO', 'Relatório enviado ao spooler; a saída física não foi confirmada.');
  finally
    SourceLines.Free;
    Lines.Free;
    Report.Free;
  end;
end;
{$ELSE}
begin
  raise EPrinterRequest.Create('RECURSO_NAO_COMPILADO', 'Este worker não inclui FortesReport.');
end;
{$ENDIF}

procedure TPrinterOperation.Danfe(const AGeneratePDF: Boolean);
{$IFDEF ACBR_PRINTER_NFE}
var
  NFe: TACBrNFe;
  Report: TACBrDFeDANFeReport;
  POSDevice: TACBrPosPrinter;
  PDF: TMemoryStream;
  XML, EncodedXML: string;
  Model: Integer;

  procedure ValidateDocument;
  var
    Document: TXMLDocument;
    Stream: TStringStream;
    Notes: TDOMNodeList;
    Info: TDOMNode;
    Identifier: string;
    C: Char;
  begin
    Document := nil;
    Notes := nil;
    Stream := TStringStream.Create(XML);
    try
      try
        ReadXMLFile(Document, Stream);
      except
        raise EPrinterRequest.Create('XML_INVALIDO', 'O documento XML não está bem formado.');
      end;
      if not Assigned(Document.DocumentElement) or
         ((Document.DocumentElement.NodeName <> 'NFe') and
          (Document.DocumentElement.NodeName <> 'nfeProc') and
          (Document.DocumentElement.NodeName <> 'procNFe')) then
        raise EPrinterRequest.Create('XML_INVALIDO', 'A raiz do XML deve ser NFe ou nfeProc.');
      Notes := Document.GetElementsByTagName('NFe');
      if Notes.Count <> 1 then
        raise EPrinterRequest.Create('XML_INVALIDO', 'Informe exatamente uma NF-e ou NFC-e no XML.');
      Info := Notes[0].FindNode('infNFe');
      if not (Info is TDOMElement) then
        raise EPrinterRequest.Create('XML_INVALIDO', 'O XML não contém infNFe.');
      Identifier := TDOMElement(Info).GetAttribute('Id');
      if (Length(Identifier) <> 47) or (Copy(Identifier, 1, 3) <> 'NFe') then
        raise EPrinterRequest.Create('XML_INVALIDO', 'infNFe.Id deve conter NFe seguido da chave de 44 dígitos.');
      for C in Copy(Identifier, 4, 44) do
        if not (C in ['0'..'9']) then
          raise EPrinterRequest.Create('XML_INVALIDO', 'A chave em infNFe.Id deve ser numérica.');
    finally
      Notes.Free;
      Document.Free;
      Stream.Free;
    end;
  end;
begin
  EncodedXML := StringValue(FRequest, 'xmlBase64', '');
  if (EncodedXML = '') or (Length(EncodedXML) > ((MaximumXMLBytes + 2) div 3) * 4) then
    raise EPrinterRequest.Create('XML_INVALIDO', 'xmlBase64 ausente ou maior que 2 MiB.');
  try
    XML := DecodeStringBase64(EncodedXML, True);
  except
    raise EPrinterRequest.Create('XML_INVALIDO', 'xmlBase64 não é uma codificação base64 válida.');
  end;
  if (Length(XML) = 0) or (Length(XML) > MaximumXMLBytes) or
     (Pos('<!DOCTYPE', UpperCase(XML)) > 0) or (Pos('<!ENTITY', UpperCase(XML)) > 0) then
    raise EPrinterRequest.Create('XML_INVALIDO', 'XML vazio, excessivo ou com declarações externas.');
  ValidateDocument;
  NFe := TACBrNFe.Create(nil);
  Report := nil;
  POSDevice := nil;
  PDF := nil;
  try
    // Apenas leitura local. Não assina, valida certificado, transmite ou consulta.
    if not NFe.NotasFiscais.LoadFromString(XML, False) or (NFe.NotasFiscais.Count <> 1) then
      raise EPrinterRequest.Create('XML_INVALIDO', 'Informe exatamente uma NF-e ou NFC-e no XML.');
    Model := NFe.NotasFiscais[0].NFe.Ide.modelo;
    if not (Model in [55, 65]) then
      raise EPrinterRequest.Create('MODELO_NAO_SUPORTADO', 'O documento deve ter modelo 55 ou 65.');
    if NFe.NotasFiscais[0].NFe.Det.Count = 0 then
      raise EPrinterRequest.Create('XML_INVALIDO', 'O documento não contém itens para impressão.');
    if AGeneratePDF or (FMode = 'spooler') then
    begin
      {$IFDEF ACBR_PRINTER_FORTES}
      if Model = 55 then
      begin
        Report := TACBrNFeDANFeRL.Create(nil);
        TACBrNFeDANFeRL(Report).TipoDANFE := tiRetrato;
      end
      else
      begin
        Report := TACBrNFeDANFCeFortes.Create(nil);
        TACBrNFeDANFCeFortes(Report).LarguraBobina := Round(FPaperWidth * 96 / 25.4);
      end;
      {$ELSE}
      raise EPrinterRequest.Create('RECURSO_NAO_COMPILADO', 'DANFE gráfico e PDF requerem FortesReport.');
      {$ENDIF}
    end
    else
    begin
      if Model <> 65 then
        raise EPrinterRequest.Create('MODO_INCOMPATIVEL', 'DANFE ESC/POS está disponível apenas para NFC-e modelo 65.');
      if Trim(FPort) = '' then
        raise EPrinterRequest.Create('CONFIGURACAO_INVALIDA', 'porta é obrigatória para escpos.');
      POSDevice := NewPOSPrinter(FPort);
      Report := TACBrNFeDANFeESCPOS.Create(nil);
      TACBrNFeDANFeESCPOS(Report).PosPrinter := POSDevice;
    end;
    Report.MostraPreview := False;
    Report.MostraSetup := False;
    Report.MostraStatus := False;
    Report.NumCopias := FCopies;
    Report.NomeDocumento := 'DANFE';
    NFe.DANFE := Report;
    if AGeneratePDF then
    begin
      PDF := TMemoryStream.Create;
      Report.NumCopias := 0;
      Report.ImprimirDANFEPDF(PDF, NFe.NotasFiscais[0].NFe);
      if PDF.Size = 0 then
        raise EPrinterRequest.Create('PDF_VAZIO', 'O componente não retornou um PDF.');
      FReply.Add('pdfBase64', StreamBase64(PDF));
      Finish('GERADO', 'DANFE PDF gerado a partir do XML; nenhuma impressão foi iniciada.');
    end
    else
    begin
      if FMode = 'spooler' then
      begin
        RequireInstalledPrinter;
        Report.Impressora := FPrinter;
      end;
      BeginPhysicalSend;
      Report.ImprimirDANFE(NFe.NotasFiscais[0].NFe);
      Finish('ENVIADO', 'DANFE enviado ao destino; a saída física não foi confirmada.');
    end;
  finally
    PDF.Free;
    NFe.DANFE := nil;
    Report.Free;
    POSDevice.Free;
    NFe.Free;
  end;
end;
{$ELSE}
begin
  raise EPrinterRequest.Create('RECURSO_NAO_COMPILADO', 'Este worker não inclui o adaptador DANFE.');
end;
{$ENDIF}

function TPrinterOperation.Execute: TJSONObject;
begin
  try
    ReadConfiguration;
    if FCommand = 'capacidades' then Capabilities
    else if FCommand = 'listarImpressoras' then ListPrinters
    else if FCommand = 'gerarEscpos' then GenerateEscpos
    else if FCommand = 'imprimirTexto' then PrintText
    else if FCommand = 'danfePdf' then Danfe(True)
    else if FCommand = 'imprimirDanfe' then Danfe(False)
    else raise EPrinterRequest.Create('COMANDO_NAO_SUPORTADO', 'Comando não suportado.');
  except
    on E: EPrinterRequest do
    begin
      FReply.Booleans['sucesso'] := False;
      FReply.Strings['estado'] := 'ERRO';
      FReply.Add('codigo', E.Code);
      FReply.Strings['mensagem'] := ProtocolMessageUTF8(E.Message);
    end;
    on E: Exception do
    begin
      FReply.Booleans['sucesso'] := False;
      FReply.Strings['estado'] := 'ERRO';
      FReply.Add('codigo', 'ERRO_ACBR');
      FReply.Strings['mensagem'] := ProtocolMessageUTF8(E.Message);
    end;
  end;
  if not FReply.Booleans['sucesso'] then
    FReply.Add('resultadoIncerto', FSendStarted);
  Result := FReply;
  FReply := nil;
end;

function ExecutePrinterRequest(ARequest: TJSONObject): TJSONObject;
var
  Operation: TPrinterOperation;
begin
  Operation := TPrinterOperation.Create(ARequest);
  try
    Result := Operation.Execute;
  finally
    Operation.Free;
  end;
end;

end.
