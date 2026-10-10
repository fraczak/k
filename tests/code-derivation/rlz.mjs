import { t, in_out } from './index.mjs';
import assert from 'assert';

t(`
 zero = {}|_|0;
 rlz = ?<X 0, X 1, {} _>=X </0/_ zero, /0 rlz, ()> ?X;
 rlz
 `, (annotated) => {
    const {input,output} = in_out(annotated);
    assert.equal(output.type, input.type);
    assert.equal(output.type, "@VtPHxGf5GNMzzyVFxtv7gegFfJRYapBGtCeyV56bs5Zb");
    console.log("OK");
 });