import { t, in_out } from './index.mjs';
import assert from 'assert';

t(`$b = < {} true, {} false > ;
   true = {{} true} $b;
   false = {{} false} $b; 
   not = $b < .true false, .false true >;
   not not
`, (annotated) => {
   const {input,output} = in_out(annotated);
   assert.equal(input.type, annotated.representatives["b"]);
   assert.equal(output.type, annotated.representatives["b"]);
   console.log("OK");
   });
