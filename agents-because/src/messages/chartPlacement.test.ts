import {
  buildPlaceholder,
  placePrepend,
  placeSemantic,
  stripChartPlaceholders,
  ChartPlacementBufferMap,
} from './chartPlacement';

describe('chartPlacement', () => {
  it('builds marker placeholders', () => {
    expect(buildPlaceholder('zb', 'c1')).toBe('@ec@zb:c1@ec@');
    expect(buildPlaceholder(undefined, 'c1', 'line')).toBe('@ec@line:c1@ec@');
  });

  it('placePrepend inserts before body', () => {
    expect(placePrepend('你好', ['@ec@zb:c1@ec@'])).toContain('@ec@zb:c1@ec@');
    expect(placePrepend('你好', ['@ec@zb:c1@ec@']).endsWith('你好')).toBe(true);
  });

  it('placeSemantic inserts near section headings', () => {
    const text = '## 主要贡献\n说明文字';
    const out = placeSemantic(text, '@ec@bar:c2@ec@', 'contribution');
    expect(out.indexOf('@ec@bar:c2@ec@')).toBeGreaterThan(
      out.indexOf('主要贡献'),
    );
  });

  it('stripChartPlaceholders removes markers', () => {
    expect(stripChartPlaceholders('前@ec@zb:c1@ec@后')).toBe('前后');
  });

  it('buffer flushes on paragraph boundary', () => {
    const map = new ChartPlacementBufferMap();
    map.activate('s1', ['@ec@bar:c1@ec@'], ['indicator']);
    expect(map.pushDelta('s1', 'hello')).toBeNull();
    const flushed = map.pushDelta('s1', '\n\nworld');
    expect(flushed).toContain('@ec@bar:c1@ec@');
    expect(flushed).toContain('hello');
  });
});
