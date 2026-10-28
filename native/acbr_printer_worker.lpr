program acbr_printer_worker;

{$mode objfpc}{$H+}{$codepage utf8}

uses
  {$IFDEF UNIX}cthreads,{$ENDIF}
  Interfaces, Forms, Classes, SysUtils, fpjson, jsonparser,
  acbr_printer_engine;

function ReadRequestLine: string;
const
  MaximumLineBytes = 8 * 1024 * 1024;
var
  Used, Capacity: SizeInt;
  C: Char;
begin
  Used := 0;
  SetLength(Result, 65536);
  while not EOF(Input) do
  begin
    Read(Input, C);
    if C = #10 then Break;
    if Used >= MaximumLineBytes then
      raise Exception.Create('A requisição JSONL excede 8 MiB.');
    if Used = Length(Result) then
    begin
      Capacity := Length(Result) * 2;
      if Capacity > MaximumLineBytes then Capacity := MaximumLineBytes;
      SetLength(Result, Capacity);
    end;
    Inc(Used);
    Result[Used] := C;
  end;
  if (Used > 0) and (Result[Used] = #13) then Dec(Used);
  SetLength(Result, Used);
end;

var
  Line: string;
  Request: TJSONData;
  Reply: TJSONObject;
begin
  SetTextCodePage(Input, 65001);
  SetTextCodePage(Output, 65001);
  Request := nil;
  Reply := nil;
  try
    try
      Application.ShowMainForm := False;
      Application.Initialize;
      if EOF(Input) then
        raise Exception.Create('Envie uma requisição JSONL em stdin.');
      Line := ReadRequestLine;
      Request := GetJSON(Line);
      if Request.JSONType <> jtObject then
        raise Exception.Create('A requisição deve ser um objeto JSON.');
      Reply := ExecutePrinterRequest(TJSONObject(Request));
    except
      on E: Exception do Reply := PrinterProtocolError(E.Message);
    end;
    WriteLn(Output, Reply.AsJSON);
    Flush(Output);
  finally
    Reply.Free;
    Request.Free;
  end;
end.
