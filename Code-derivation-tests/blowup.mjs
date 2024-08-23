import { t, in_out } from './index.mjs';
import fs from 'node:fs';
import assert from 'assert';

// t(fs.readFileSync("./Examples/blowup.k").toString("utf8"), (annotated) => {
//     // console.log(JSON.stringify(annotated,null,2));
//     const {input,output} = in_out(annotated);
//     console.log(input);
//     console.log(output);
//     assert.equal(output.pattern, '<...>');
//     assert.equal(input.pattern, '(...)');
//     console.log("OK");
// });

t(`
  B = {{} u} A;
  A = < .a, .b A, .c {() z} A, B  >;
  A
`, (annotated) => {
    // console.log(JSON.stringify(annotated,null,2));
    const {input,output} = in_out(annotated);
    console.log(input);
    console.log(output);
    assert.equal(output.type, annotated.representatives["bnat"]);
    assert.equal(input.type, annotated.representatives["pair"]);
    console.log("OK");
});
