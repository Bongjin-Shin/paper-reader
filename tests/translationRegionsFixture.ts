import { PDFDocument, StandardFonts } from 'pdf-lib';

/** Synthetic layout reproducing floating captions and publisher furniture. */
export async function makeTranslationRegionsPdf() {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  for (let n = 1; n <= 2; n++) {
    const page = doc.addPage([612, 792]);
    const line = (text: string, x: number, y: number, size = 10) => page.drawText(text, { x, y, size, font });
    line('IEEE Robotics Letters. Preprint accepted for publication.', 100, 778, 7);
    line(`Authorized licensed use. Copyright IEEE. Page ${n}.`, 100, 18, 7);
    if (n === 1) {
      page.drawText('Multi-robot task allocation', { x: 90, y: 730, size: 18, font: bold });
      line('I. INTRODUCTION', 65, 704);
      line('Robots cooperate in rescue missions.', 40, 680);
      line('The scenario involves robots', 40, 640);
      line('with varying abilities', 40, 626);
      line('Fig. 1. A cooperative rescue scenario.', 330, 640, 8);
      line('The robots work together, with plans', 330, 630, 8);
      line('shown as arrows.', 330, 620, 8);
      line('in signal strength, sensing, and payload.', 330, 594);
      line('Another complete body sentence follows.', 330, 570);
      line('The method is learned through training.', 330, 556);
      line('Learning can fail because agents', 330, 116);
      line('can hardly learn any useful', 330, 102);
      line('Manuscript received: August 28, 2024.', 40, 130, 8);
      line('Authors are with the research institute.', 40, 120, 8);
    } else {
      line('strategies from incomplete experiences.', 40, 700);
      line('We propose a reinforcement learning', 40, 682);
      line('approach that improves cooperation.', 40, 668);
      line('It coordinates different robot skills.', 330, 700);
      line('Further studies can improve the method.', 330, 682);
      line('The final result is promising.', 330, 668);
    }
  }
  return doc.save();
}
