const {
  getConversationChartIdOffset,
  getConversationChartIndexOffset,
} = require('./chartIdSequence');

describe('getConversationChartIdOffset', () => {
  it('returns the largest chart_N id from historical assistant messages', () => {
    expect(
      getConversationChartIdOffset([
        { isCreatedByUser: false, text: '@ec@zb:chart_1@ec@\n正文' },
        {
          isCreatedByUser: false,
          text: '@ec@result:chart_2@ec@\n@ec@result:chart_4@ec@',
        },
      ])
    ).toBe(4);
  });

  it('ignores user-authored markers and non-sequential chart ids', () => {
    expect(
      getConversationChartIdOffset([
        { isCreatedByUser: true, text: '@ec@zb:chart_99@ec@' },
        { isCreatedByUser: false, text: '@ec@line:zb_random@ec@' },
        { isCreatedByUser: false, text: '@ec@zb:chart_3@ec@' },
      ])
    ).toBe(3);
  });

  it('returns zero when the branch has no sequential chart ids', () => {
    expect(getConversationChartIdOffset([])).toBe(0);
  });

  it('reads chart markers from structured assistant content when text is empty', () => {
    expect(
      getConversationChartIdOffset([
        {
          isCreatedByUser: false,
          text: '',
          content: [{ type: 'text', text: '@ec@zb:chart_7@ec@' }],
        },
      ]),
    ).toBe(7);
  });
});

describe('getConversationChartIndexOffset', () => {
  it('continues the highest session-scoped automatic chart suffix', () => {
    expect(
      getConversationChartIndexOffset([
        { isCreatedByUser: false, text: '@ec@line:zb_5c01549bf7a1390c_0@ec@' },
        { isCreatedByUser: false, text: '@ec@pie:zb_5c01549bf7a1390c_3@ec@' },
      ]),
    ).toBe(4);
  });

  it('ignores user-authored and legacy ids', () => {
    expect(
      getConversationChartIndexOffset([
        { isCreatedByUser: true, text: '@ec@line:zb_5c01549bf7a1390c_9@ec@' },
        { isCreatedByUser: false, text: '@ec@zb:chart_4@ec@' },
      ]),
    ).toBe(0);
  });

  it('reads session ids from structured assistant content when text is empty', () => {
    expect(
      getConversationChartIndexOffset([
        {
          isCreatedByUser: false,
          text: '',
          content: [
            { type: 'text', text: '@ec@line:zb_5c01549bf7a1390c_0@ec@' },
          ],
        },
      ]),
    ).toBe(1);
  });
});
