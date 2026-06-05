const ADJECTIVES = [
  'Swift', 'Cosmic', 'Silent', 'Brave', 'Lucky', 'Neon', 'Frosty', 'Golden',
  'Mystic', 'Pixel', 'Shadow', 'Sunny', 'Wild', 'Zen', 'Crimson', 'Electric',
];

const ANIMALS = [
  'Fox', 'Panda', 'Wolf', 'Otter', 'Hawk', 'Tiger', 'Koala', 'Lynx',
  'Falcon', 'Badger', 'Raven', 'Dolphin', 'Phoenix', 'Dragon', 'Bear', 'Owl',
];

/** Generate a random display name like "SwiftFox42". */
export function generateUsername(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const num = Math.floor(Math.random() * 90) + 10;
  return `${adj}${animal}${num}`;
}
