import { t, in_out } from './index.mjs';
import fs from 'node:fs';
import assert from 'assert';

t(fs.readFileSync("./Examples/nat.k", "utf8"), (annotated) => {
    const {input,output} = in_out(annotated);
    assert.equal(output.type, input.type);
    assert.equal(output.type, "@e9WP6QX6URfgnd9hHYrrYUBhiL7UcvbWErVmyQJfFcr8");
    console.log("OK");
});