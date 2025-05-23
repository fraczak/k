import { t, in_out } from './index.mjs';
import { unitCode } from '../codes.mjs';
import assert from 'assert';

function is_result_code(code) {
    return function(annotated) {
        // console.log(annotated);
        const {output} = in_out(annotated);
        assert.strictEqual(output.type, code);
        console.log('OK');
    }
}

t('"ala"', is_result_code('@bits'));
t('"a" $@bits', is_result_code('@bits'));
t('0xFFFF', is_result_code('@bits'));
// t('"a" . "a"', is_result_code(unitCode));
t('0xFFFF $@bits', is_result_code('@bits'));
// t(' 1 . 1', is_result_code(unitCode));
t('0xFFFF / 0b1111', is_result_code('@bits'));

