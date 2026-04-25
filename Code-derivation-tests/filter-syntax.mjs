import assert from 'assert';
import { annotate } from '../index.mjs';

function succeeds(script) {
  assert.doesNotThrow(() => annotate(script));
}

function fails(script) {
  assert.throws(() => annotate(script));
}

succeeds('?(...)');
succeeds('?{...}');
succeeds('?<...>');
succeeds('?{}');
succeeds('?<>');

fails('?()');
fails('?(X x, ...)');

console.log("OK");
