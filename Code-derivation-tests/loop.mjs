import { t, in_out } from './index.mjs';
import assert from 'assert';

t(` < .a, () > `, (annotated) => {
    const {input,output} = in_out(annotated);
    assert.equal(input.pattern, "(...)");
    assert.equal(output, input); 
    console.log("OK");
}); 

// Notice that the following are equivalent: '<(), .a>', '<()>', and '()';