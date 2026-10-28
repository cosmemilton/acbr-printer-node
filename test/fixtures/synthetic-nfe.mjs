// Synthetic local data only; never send to SEFAZ or a physical printer.
export function syntheticXml(model) {
  const number = model === 55 ? 1 : 2;
  const prefix = `26261011222333000181${model}001${String(number).padStart(9, '0')}112345678`;
  let sum = 0;
  for (const [index, character] of [...prefix].reverse().entries()) sum += Number(character) * (2 + index % 8);
  const rawDigit = 11 - sum % 11;
  const digit = rawDigit > 9 ? 0 : rawDigit;
  const key = prefix + digit;
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${key}" versao="4.00">
<ide><cUF>26</cUF><cNF>12345678</cNF><natOp>VENDA TESTE SINTETICA</natOp><mod>${model}</mod><serie>1</serie><nNF>${number}</nNF><dhEmi>2026-10-28T12:00:00-03:00</dhEmi><tpNF>1</tpNF><idDest>1</idDest><cMunFG>2611606</cMunFG><tpImp>${model === 55 ? 1 : 4}</tpImp><tpEmis>1</tpEmis><cDV>${digit}</cDV><tpAmb>2</tpAmb><finNFe>1</finNFe><indFinal>1</indFinal><indPres>1</indPres><procEmi>0</procEmi><verProc>TESTE-IMPRESSAO</verProc></ide>
<emit><CNPJ>11222333000181</CNPJ><xNome>EMITENTE SINTETICO DE TESTE</xNome><xFant>NAO E DOCUMENTO FISCAL</xFant><enderEmit><xLgr>RUA DE TESTE</xLgr><nro>1</nro><xBairro>CENTRO</xBairro><cMun>2611606</cMun><xMun>RECIFE</xMun><UF>PE</UF><CEP>50000000</CEP><cPais>1058</cPais><xPais>BRASIL</xPais></enderEmit><IE>000000000</IE><CRT>3</CRT></emit>
<dest><CNPJ>22333444000182</CNPJ><xNome>NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</xNome><enderDest><xLgr>RUA SINTETICA</xLgr><nro>2</nro><xBairro>CENTRO</xBairro><cMun>2611606</cMun><xMun>RECIFE</xMun><UF>PE</UF><CEP>50000000</CEP><cPais>1058</cPais><xPais>BRASIL</xPais></enderDest><indIEDest>9</indIEDest></dest>
<det nItem="1"><prod><cProd>TESTE</cProd><cEAN>SEM GTIN</cEAN><xProd>ITEM SINTETICO - SEM VALOR FISCAL</xProd><NCM>49019900</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>10.0000000000</vUnCom><vProd>10.00</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>UN</uTrib><qTrib>1.0000</qTrib><vUnTrib>10.0000000000</vUnTrib><indTot>1</indTot></prod><imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>10.00</vBC><pICMS>0.00</pICMS><vICMS>0.00</vICMS></ICMS00></ICMS><PIS><PISNT><CST>07</CST></PISNT></PIS><COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS></imposto></det>
<total><ICMSTot><vBC>10.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>10.00</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro><vNF>10.00</vNF></ICMSTot></total><transp><modFrete>9</modFrete></transp><pag><detPag><tPag>01</tPag><vPag>10.00</vPag></detPag></pag><infAdic><infCpl>EXEMPLO SINTETICO PARA PDF. NAO TRANSMITIR NEM IMPRIMIR.</infCpl></infAdic></infNFe></NFe></nfeProc>`;
}
