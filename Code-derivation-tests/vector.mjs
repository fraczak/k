import { t, in_out } from './index.mjs';
import assert from 'assert';

t('[]', (annotated) => {
  const {input,output} = in_out(annotated);
  assert.equal(input.pattern, '(...)');
  assert.equal(output.pattern, "[]");
  console.log("OK");
});

t("$@bits [ $@bits 'true', 'false' ] .0",  (annotated) => {
  const {input,output} = in_out(annotated);
  assert.equal(input.type, "@bits");
  assert.equal(output.type, "@bits");
  console.log("OK");
});

assert.throws(() => t(`$@bits [ $@bits 'true', {} ]`), /Error/);
console.log("OK");
