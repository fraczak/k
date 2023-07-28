import { t, in_out } from './index.mjs';
import assert from 'assert';

t('[]', (annotated) => {
  const {input,output} = in_out(annotated);
  assert.equal(input.type, null);
  assert.equal(output.type, "vector");
  console.log("OK");
});

t(`$int [ $int true, false ]`);
