import { t, in_out } from './index.mjs';
import fs from 'node:fs';
import assert from 'assert';

t(fs.readFileSync("./Examples/nat.k").toString("utf8"), (annotated) => {
    const {input,output} = in_out(annotated);
    assert.equal(output.code, annotated.representatives["nat"]);
    assert.equal(input.code, annotated.representatives["nat"]);
    console.log("OK");
});