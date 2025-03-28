import { t, in_out } from './index.mjs';
import assert from 'assert';

function is_result_code(code) {
    return function(annotated) {
        const {output} = in_out(annotated);
        assert.strictEqual(output.type, code);
        console.log('OK');
    }
}

t('true', is_result_code('@bool'));
t('false $@bool', is_result_code('@bool'));
t('1', is_result_code('@int'));
t('12 $@int', is_result_code('@int'));
t('"ala"', is_result_code('@string'));
t('"a" $@string', is_result_code('@string'));

t('${} true $@bool 1 $@int "a" $@string', is_result_code('@string'));