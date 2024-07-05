import { t, in_out } from './index.mjs';
import assert from 'assert';

t(`$b = < {} true, {} false > ;
   true = {{} true} $b;
   false = {{} false} $b; 
   not = $b < .true false, .false true >;
   not not
`, (annotated) => {
   const {input,output} = in_out(annotated);
   assert.equal(input.code, annotated.representatives["b"]);
   assert.equal(output.code, annotated.representatives["b"]);
   console.log("OK");
   });
