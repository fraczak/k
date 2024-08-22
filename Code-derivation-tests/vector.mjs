import { t, in_out } from './index.mjs';
import assert from 'assert';

t('[]', (annotated) => {
  const {input,output} = in_out(annotated);
  assert.equal(input.pattern, '(...)');
  assert.equal(output.pattern, "[]");
  console.log("OK");
});

t("$int [ $int true, false ] .0",  (annotated) => {
  const {input,output} = in_out(annotated);
  assert.equal(input.type, "int");
  assert.equal(output.type, "bool");
  console.log("OK");
});

assert.throws(() => t(`$int [ $int true, 12 ]`), /Error/);
console.log("The both errors are expected...");
console.log("OK");

// t(`[]`);