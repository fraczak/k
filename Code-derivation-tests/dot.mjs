import { t, in_out } from './index.mjs';
import assert from 'assert';

t(`
$b = < {} true, {} false > ; 
$pair = { b one, b two } ;

$b {1 one, () two, () c} .one

`, (annotated) => {
    console.log(JSON.stringify(annotated, null, 2));
});