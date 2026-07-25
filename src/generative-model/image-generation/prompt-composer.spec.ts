import {
  composeImagePrompt,
  richTextToPlainPrompt,
} from './prompt-composer.js';

describe('richTextToPlainPrompt', () => {
  it('strips HTML and collapses whitespace', () => {
    expect(
      richTextToPlainPrompt('<p>A <strong>hero</strong> enters</p><br/>the bathhouse'),
    ).toBe('A hero enters\nthe bathhouse');
  });

  it('extracts text from TipTap/ProseMirror JSON', () => {
    const doc = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Orange cat on a windowsill' }],
        },
      ],
    });
    expect(richTextToPlainPrompt(doc)).toBe('Orange cat on a windowsill');
  });

  it('strips basic markdown', () => {
    expect(richTextToPlainPrompt('## Scene\nA **bold** hero')).toBe(
      'Scene\nA bold hero',
    );
  });
});

describe('composeImagePrompt', () => {
  it('prefers config prompt over connected texts', () => {
    expect(
      composeImagePrompt({
        configPrompt: 'Garbage can only',
        connectedTexts: ['Orange cat'],
        style: 'painterly',
      }),
    ).toBe('Garbage can only\n\nStyle: painterly');
  });

  it('joins connected rich-text sections when no override', () => {
    expect(
      composeImagePrompt({
        connectedTexts: ['<p>Section A</p>', '<p>Section B</p>'],
      }),
    ).toBe('Section A\n\nSection B');
  });

  it('respects useConnectedSectionText=false', () => {
    expect(
      composeImagePrompt({
        connectedTexts: ['Should ignore'],
        useConnectedSectionText: false,
        style: 'ink wash',
      }),
    ).toBe('Style: ink wash');
  });
});
