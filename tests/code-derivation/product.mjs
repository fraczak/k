import { t, in_out } from './index.mjs';
import assert from 'assert';
import hash from "../../hash.mjs";

const unitCode = hash('$C0={};');

t('{}', (annotated) => {
  const {input,output} = in_out(annotated);
  assert.equal(input.pattern, '(...)');
  assert.equal(output.type, unitCode);
  console.log("OK");
});

t(`
  ?< {} true, {} false > {() one, () two} ?{ < {} true, {} false > one, < {} true, {} false > two }
`, (annotated) => {
  const {input,output} = in_out(annotated);

  assert.equal(input.type, "@GWnxJCupZr96BZfdpDsfQQKxKjCbjyDh7Qaur7y9enCY");
  assert.equal(output.type, "@ZR2yff4pdXTVqZdMu9x3t9GG5rwmhEfQuenbAwFnD2Nk");
  console.log("OK");
});
