import { t, in_out } from './index.mjs';
import fs from 'node:fs';
import assert from 'assert';

t(fs.readFileSync("./Examples/bnat-patterns.k").toString("utf8"), (annotated) => {
    // console.log(JSON.stringify(annotated,null,2));
    const {input,output} = in_out(annotated);
    console.log(output);
    assert.equal(output.type, annotated.representatives["bnat"]);
    assert.equal(input.type, annotated.representatives["pair"]);
    console.log("OK");
});