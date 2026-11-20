const assert=require('assert/strict');
const {parseOrdinal,ordinalInRequest}=require('../services/ai/spanishOrdinal');
for(const [text,n] of [['vigésimo segundo',22],['vigesimosegundo',22],['centésimo duodécimo',112],['ducentésimo cuadragésimo quinto',245],['nonagésimo noveno',99],['milésimo primero',1001],['dosmilésimo',2000],['22º',22]])assert.equal(parseOrdinal(text),n,text);
assert.equal(ordinalInRequest('mirá, quiero el vigesimosegundo'),22);
assert.equal(ordinalInRequest('entre el segundo y el tercero'),null);
assert.equal(parseOrdinal('segundo primero'),null);
assert.equal(parseOrdinal('bajar'),null);
console.log('PASS: ordinales compuestos, posición exacta y ambigüedad.');
