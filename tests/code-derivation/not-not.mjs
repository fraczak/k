import { t, in_out } from './index.mjs';
import assert from 'assert';

t(`
   true = {} |true;
   false = {} |false; 
   not = ?< {} true, {} false > < /true false, /false true > ?< {} true, {} false >;
   not not
`, (annotated) => {
   const {input,output} = in_out(annotated);
   assert.equal(input.type, output.type);
   assert.equal(input.type, "@GWnxJCupZr96BZfdpDsfQQKxKjCbjyDh7Qaur7y9enCY");
   console.log("OK");
   });
