import { t, in_out } from './index.mjs';
import assert from 'assert';

t(`$b = < {} true, {} false > ;
   true = {{} true} $b;
   false = {{} false} $b; 
   not = $b < .true false, .false true >;
   not not
`, (annotated) => {
   const {input,output} = in_out(annotated);
   assert.equal(input.code, "b");
   assert.equal(output.code, "b");
   console.log("OK");
   });
