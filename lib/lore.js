// THE INNER VOICE — what lore writes down the first time you do a thing.
// The sim keeps WHEN (`noted`: a first's id, its day and minute, and your lore
// as it was written); this is WHAT it says. An entry is lines by lore: the
// first is always said, and each further one only if your lore had reached its
// rung (SAYS) when it was written — the more you know, the more you notice.
// The ids:
//   verb        move, scout, gather, hunt, eat, cook, craft, build, drop, take,
//               learn, teach, raft, bridge, sleep
//   moment      gate, board, figure, exhaustion
// Every line is written by hand (placeholder text, to be rewritten).
import { hhmm } from "./clock.js"

export const SAYS = [1, 2, 3] // the lore each line needs: the first, the second, the third

const VERBS = {
  move: ["Moving along"],
  scout: ["I can see stuff"],
  gather: ["I took something from the ground, and it let me.", "A spot gives only so much before it tires.", "Left alone a day, it comes back a little."],
  hunt: ["Something living, and now it's mine.", "The catch needs its tool. Hands aren't enough.", "A hunted place stays empty a while."],
  eat: ["I ate. The day grew a little longer.", "Food is time. What I eat comes back as minutes.", "Hunger keeps its own clock, and each food pushes it on by what it's worth."],
  cook: ["Fire on food. It came out as something else.", "Cooked, food is worth three times as much.", "It keeps longer, too. The fire is a kind of keeping."],
  craft: ["My hands made something that wasn't there.", "What I make, I carry, and what I carry, I can use.", "Making it again, the hands remember."],
  build: ["I built something that stays where I put it.", "It belongs to the place, not to me."],
  drop: ["I set something down. It will wait for me.", "Nothing put down is lost.", "Any ground holds as many kinds as I leave there."],
  take: ["I picked it up. My back is heavier.", "Weight slows every step.", "There's only so much I can carry."],
  learn: ["Someone showed me, and now I know.", "A lesson takes an hour.", "No one can teach past what they know."],
  teach: ["I gave what I knew to someone else.", "What I teach, I lose, until I've mastered it.", "It can lift them past what they were born with."],
  raft: ["Branches and cord, and the water holds me.", "It stays where I leave it.", "It only moves with me on it."],
  bridge: ["The river has a way across now, and it will stay.", "A bridge goes both ways."],
  sleep: ["Was this a dream?"]
}

const MOMENTS = {
  gate: { head: "let there be light", lines: ["the Arrow of Light is back home! it breached the wall, there's all this stuff on the ground now."] },
  board: { head: "another board", lines: ["This isn't home. The ground is different here.", "Rivers run round every board.", "The world is round, laid flat."] },
  figure: { head: "a figure", lines: ["Someone else. I'm not alone.", "They know things. Some know more than me.", "Each is best at what their land teaches."] },
  exhaustion: { head: "exhaustion", lines: ["i feel tired all of a sudden. i need to find sleep"] }
}

// the head and every line an id CAN say, before lore picks how many are said
const entryOf = id => MOMENTS[id] || { head: id, lines: VERBS[id] || [] }

// A FIRST AS THE VOICE SAYS IT: { id, head, when, lines } — its lines cut to the
// lore it was written at, and only the ones that have something to say.
export function voiceOf(n) {
  const e = entryOf(n.id)
  return {
    id: n.id,
    head: e.head,
    when: `day ${n.day} · ${hhmm(n.at)}`,
    lines: e.lines.filter((l, i) => l && (n.lore ?? 1) >= SAYS[i])
  }
}
