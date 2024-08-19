import { t, in_out } from './index.mjs';
import assert from 'assert';

t(`
 $nat = < {} _, nat 0, nat 1>;
 zero = {{{} _} 0} $nat;
 rlz =  <.0._ zero, .0 rlz, ()>;
 rlz
 `, (annotated) => {
    const {input,output} = in_out(annotated);
    assert.equal(output.type, annotated.representatives["nat"]);
    assert.equal(input.type, annotated.representatives["nat"]);
    console.log("OK");
 });