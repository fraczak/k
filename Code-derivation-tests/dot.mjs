import { t, in_out } from './index.mjs';
import assert from 'assert';

t(`
$b = < {} true, {} false > ; 
$pair = { b one, b two } ;

$b {1 one, () two, () c} .one

`, (annotated) => {
    const {input,output} = in_out(annotated);
    assert.equal(input.code, annotated.representatives["b"]);
    assert.equal(output.code, "int");
    console.log("OK");
});