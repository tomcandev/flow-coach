// Original practice content written for Flow Coach (Nov 2026).
// No sentences are taken from any commercial or crawled question bank.

export interface DictationItem {
  id: string;
  text: string;
}

export interface WritingItem {
  id: string;
  prompt: string;
  minWords: number;
  maxWords: number;
}

const sentences = [
  'The library extends its opening hours during the final examination period.',
  'Students are required to submit their assignments through the online portal.',
  'Most research projects begin with a careful review of existing literature.',
  'The lecture on renewable energy has been moved to the main theatre.',
  'International students often benefit from joining study groups in their first semester.',
  'The committee approved the new budget after a lengthy discussion.',
  'Climate scientists analysed temperature records collected over several decades.',
  'A balanced diet contributes significantly to good physical health.',
  'The survey results were published in an academic journal last month.',
  'Urban planners must consider public transport when designing new suburbs.',
  'The professor emphasised the importance of citing every source accurately.',
  'Several factors influence how quickly a language learner improves.',
  'The tutorial schedule is available on the faculty website.',
  'Graduates with practical experience usually find employment more quickly.',
  'Researchers observed a significant decline in local bird populations.',
  'The university introduced a new policy on academic integrity this year.',
  'Effective time management reduces stress during the assessment period.',
  'Many economists believe that inflation will stabilise next year.',
  'The experiment was repeated three times to confirm the results.',
  'Access to clean water remains a major challenge in some regions.',
  'The orientation session provides useful information for new students.',
  'Technological change has transformed the way people communicate.',
  'The assignment requires a detailed analysis of two case studies.',
  'Participants completed a questionnaire before the interview began.',
  'Public libraries offer free workshops on digital skills.',
  'The government invested heavily in renewable energy infrastructure.',
  'Regular feedback helps learners identify their strengths and weaknesses.',
  'The article examines the relationship between sleep and memory.',
  'Most of the data was collected through online surveys.',
  'An accurate summary should include only the most important ideas.',
  'The museum attracts thousands of visitors from overseas each summer.',
  'Biologists discovered a new species of frog in the northern forest.',
  'The seminar was postponed because the guest speaker was unwell.',
  'Group presentations account for a large part of the final grade.',
  'Sustainable agriculture aims to protect the soil for future generations.',
  'The results suggest that exercise improves concentration in children.',
  'Students who attend lectures regularly tend to achieve higher marks.',
  'The new laboratory was equipped with advanced scientific instruments.',
  'Rising sea levels threaten many coastal communities around the world.',
  'The essay should present a clear argument supported by evidence.',
  'Language skills develop faster when learners practise every day.',
  'The department has appointed a coordinator for international students.',
  'Early childhood education has a lasting effect on later achievement.',
  'The findings were presented at a conference in Melbourne.',
  'Online courses allow students to learn at their own pace.',
  'The researcher interviewed teachers from twelve different schools.',
  'Careful planning prevented the project from going over budget.',
  'The city council is reviewing proposals for a new cycling path.',
];

export const DICTATION_ITEMS: DictationItem[] = sentences.map((text, i) => ({
  id: `wfd-${String(i + 1).padStart(2, '0')}`,
  text,
}));

const prompts = [
  'Describe one habit that helps you study effectively.',
  'Should universities record all lectures? Give one reason for your view.',
  'Write a short email to your tutor asking for one extra week for an assignment.',
  'Explain one benefit of good public transport for a city.',
  'Describe a skill you would like to learn and explain why.',
  'Is working part-time a good idea for full-time students? Give your view.',
  'Explain why sleep matters for learning.',
  'Write a message to a classmate to arrange a study session this week.',
  'Describe one challenge of studying in another country and how to handle it.',
  'Should cities stop cars from entering the centre? Give one reason.',
  'Explain how technology has changed the way you learn.',
  'Recommend one place in your city to a new international student.',
];

export const WRITING_ITEMS: WritingItem[] = prompts.map((prompt, i) => ({
  id: `sw-${String(i + 1).padStart(2, '0')}`,
  prompt,
  minWords: 30,
  maxWords: 70,
}));
