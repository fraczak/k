import { t, in_out } from './index.mjs';
import fs from 'node:fs';
import assert from 'assert';

t(fs.readFileSync("./Examples/bnat-patterns.k").toString("utf8"), (annotated) => {
    const {input,output} = in_out(annotated);
    assert.equal(output.code, annotated.representatives["bnat"]);
    assert.equal(input.type, "product");
    assert(input.closed);
    console.log("OK");
});