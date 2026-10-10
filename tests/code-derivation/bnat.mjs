import { t, in_out } from './index.mjs';
import fs from 'node:fs';
import assert from 'assert';

t(fs.readFileSync("./Examples/bnat.k", "utf8"), (annotated) => {
    // console.log(JSON.stringify(annotated,null,2));
    const {input,output} = in_out(annotated);
    assert.equal(output.type, "@VtPHxGf5GNMzzyVFxtv7gegFfJRYapBGtCeyV56bs5Zb");
    assert.equal(input.type, "@R7RD2sgu6yPqpCQBBcJqkzxHQMZfEJLcNW4UKBcTiC3m");
    console.log("OK");
});