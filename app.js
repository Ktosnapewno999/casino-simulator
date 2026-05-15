const STARTING_BALANCE = 1000;
const STORAGE_KEY = "casino-simulator-state-v1";
const suits = ["♠", "♥", "♦", "♣"];
const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const slotSymbols = ["🍒", "🍋", "◆", "★", "BAR", "7"];
const redNumbers = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

const state = loadState();
let activeGame = "slots";
let blackjack = { deck: [], player: [], dealer: [], bet: 0, active: false, holeHidden: true };
let craps = { point: 0, bet: 0 };
let poker = { deck: [], hand: [], holds: [], bet: 0, active: false };
let muted = false;

const els = {
  balance: document.querySelector("#balance"),
  wagered: document.querySelector("#wagered"),
  won: document.querySelector("#won"),
  gamesPlayed: document.querySelector("#gamesPlayed"),
  bestWin: document.querySelector("#bestWin"),
  message: document.querySelector("#message"),
  history: document.querySelector("#history"),
  betAmount: document.querySelector("#betAmount"),
  tabs: document.querySelectorAll(".tab"),
  games: document.querySelectorAll(".game"),
  chips: document.querySelectorAll(".chip"),
  maxBetBtn: document.querySelector("#maxBetBtn"),
  resetBtn: document.querySelector("#resetBtn"),
  muteBtn: document.querySelector("#muteBtn"),
  reels: [document.querySelector("#reelA"), document.querySelector("#reelB"), document.querySelector("#reelC")],
  spinBtn: document.querySelector("#spinBtn"),
  dealerCards: document.querySelector("#dealerCards"),
  playerCards: document.querySelector("#playerCards"),
  dealerScore: document.querySelector("#dealerScore"),
  playerScore: document.querySelector("#playerScore"),
  dealBtn: document.querySelector("#dealBtn"),
  hitBtn: document.querySelector("#hitBtn"),
  standBtn: document.querySelector("#standBtn"),
  rouletteWheel: document.querySelector("#rouletteWheel"),
  rouletteResult: document.querySelector("#rouletteResult"),
  rouletteChoices: document.querySelectorAll(".choice"),
  rouletteNumber: document.querySelector("#rouletteNumber"),
  rouletteSpinBtn: document.querySelector("#rouletteSpinBtn"),
  dieA: document.querySelector("#dieA"),
  dieB: document.querySelector("#dieB"),
  rollBtn: document.querySelector("#rollBtn"),
  crapsPoint: document.querySelector("#crapsPoint"),
  crapsHint: document.querySelector("#crapsHint"),
  baccaratChoices: document.querySelectorAll("[data-baccarat]"),
  baccaratPlayerCards: document.querySelector("#baccaratPlayerCards"),
  baccaratBankerCards: document.querySelector("#baccaratBankerCards"),
  baccaratPlayerScore: document.querySelector("#baccaratPlayerScore"),
  baccaratBankerScore: document.querySelector("#baccaratBankerScore"),
  baccaratDealBtn: document.querySelector("#baccaratDealBtn"),
  pokerCards: document.querySelector("#pokerCards"),
  pokerDealBtn: document.querySelector("#pokerDealBtn"),
  pokerDrawBtn: document.querySelector("#pokerDrawBtn"),
  canvas: document.querySelector("#celebrationCanvas")
};

const ctx = els.canvas.getContext("2d");

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Number.isFinite(saved.balance)) {
      return {
        balance: saved.balance,
        wagered: saved.wagered || 0,
        won: saved.won || 0,
        gamesPlayed: saved.gamesPlayed || 0,
        bestWin: saved.bestWin || 0,
        history: Array.isArray(saved.history) ? saved.history.slice(0, 12) : []
      };
    }
  } catch (error) {
    console.warn("Could not load saved casino state.", error);
  }
  return { balance: STARTING_BALANCE, wagered: 0, won: 0, gamesPlayed: 0, bestWin: 0, history: [] };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function render() {
  els.balance.textContent = money(state.balance);
  els.wagered.textContent = money(state.wagered);
  els.won.textContent = money(state.won);
  els.gamesPlayed.textContent = String(state.gamesPlayed);
  els.bestWin.textContent = money(state.bestWin);
  els.history.innerHTML = state.history
    .map((item) => `<li class="${item.outcome}">${item.text}</li>`)
    .join("");
  saveState();
}

function setMessage(text) {
  els.message.textContent = text;
}

function addHistory(text, outcome) {
  state.history.unshift({ text, outcome });
  state.history = state.history.slice(0, 12);
}

function getBet() {
  const bet = Math.floor(Number(els.betAmount.value));
  if (!Number.isFinite(bet) || bet < 1) {
    setMessage("Enter a bet of at least $1.");
    return 0;
  }
  if (bet > state.balance) {
    setMessage("That bet is bigger than your balance.");
    return 0;
  }
  return bet;
}

function placeBet() {
  const bet = getBet();
  if (!bet) return 0;
  state.balance -= bet;
  state.wagered += bet;
  state.gamesPlayed += 1;
  return bet;
}

function pay(amount) {
  if (amount <= 0) return;
  state.balance += amount;
  state.won += amount;
  state.bestWin = Math.max(state.bestWin, amount);
  if (amount >= Number(els.betAmount.value) * 4) celebrate();
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function beep(type = "click") {
  if (muted) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const audio = new AudioContext();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const tones = { click: 360, win: 740, lose: 160 };
  oscillator.frequency.value = tones[type] || tones.click;
  oscillator.type = "triangle";
  gain.gain.setValueAtTime(0.03, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.16);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start();
  oscillator.stop(audio.currentTime + 0.16);
}

function switchGame(game) {
  activeGame = game;
  els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.game === game));
  els.games.forEach((panel) => panel.classList.toggle("active", panel.id === `${game}Game`));
  setMessage(`${game[0].toUpperCase()}${game.slice(1)} table selected.`);
}

function spinSlots() {
  const bet = placeBet();
  if (!bet) return;
  beep();
  els.spinBtn.disabled = true;
  els.reels.forEach((reel) => reel.classList.add("spinning"));

  let ticks = 0;
  const interval = setInterval(() => {
    els.reels.forEach((reel) => {
      reel.textContent = slotSymbols[randomInt(0, slotSymbols.length - 1)];
    });
    ticks += 1;
    if (ticks >= 12) {
      clearInterval(interval);
      const result = els.reels.map(() => slotSymbols[randomInt(0, slotSymbols.length - 1)]);
      els.reels.forEach((reel, index) => {
        reel.textContent = result[index];
        reel.classList.remove("spinning");
      });
      settleSlots(bet, result);
      els.spinBtn.disabled = false;
      render();
    }
  }, 85);
}

function settleSlots(bet, result) {
  const [a, b, c] = result;
  let multiplier = 0;
  if (a === "7" && b === "7" && c === "7") multiplier = 20;
  else if (a === b && b === c) multiplier = 8;
  else if (a === b || a === c || b === c) multiplier = 2;

  if (multiplier > 0) {
    const payout = bet * multiplier;
    pay(payout);
    beep("win");
    setMessage(`${result.join(" ")} pays ${multiplier}x. You won ${money(payout)}.`);
    addHistory(`Slots: ${result.join(" ")} won ${money(payout)}`, "win");
  } else {
    beep("lose");
    setMessage(`${result.join(" ")} did not connect. You lost ${money(bet)}.`);
    addHistory(`Slots: ${result.join(" ")} lost ${money(bet)}`, "loss");
  }
}

function createDeck() {
  const deck = [];
  suits.forEach((suit) => ranks.forEach((rank) => deck.push({ rank, suit })));
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardValue(card) {
  if (card.rank === "A") return 11;
  if (["K", "Q", "J"].includes(card.rank)) return 10;
  return Number(card.rank);
}

function baccaratValue(card) {
  if (["10", "J", "Q", "K"].includes(card.rank)) return 0;
  if (card.rank === "A") return 1;
  return Number(card.rank);
}

function baccaratTotal(hand) {
  return hand.reduce((sum, card) => sum + baccaratValue(card), 0) % 10;
}

function handValue(hand) {
  let total = hand.reduce((sum, card) => sum + cardValue(card), 0);
  let aces = hand.filter((card) => card.rank === "A").length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function renderBlackjack() {
  els.playerCards.innerHTML = blackjack.player.map(renderCard).join("");
  els.dealerCards.innerHTML = blackjack.dealer
    .map((card, index) => (index === 1 && blackjack.holeHidden ? '<div class="card back" aria-label="Hidden card"></div>' : renderCard(card)))
    .join("");
  els.playerScore.textContent = handValue(blackjack.player);
  els.dealerScore.textContent = blackjack.holeHidden ? handValue([blackjack.dealer[0] || { rank: "0", suit: "♠" }]) : handValue(blackjack.dealer);
}

function renderCard(card) {
  const red = card.suit === "♥" || card.suit === "♦" ? " red" : "";
  return `<div class="card${red}" aria-label="${card.rank} ${card.suit}"><span>${card.rank}</span><span>${card.suit}</span></div>`;
}

function renderPokerCard(card, index) {
  const held = poker.holds[index] ? " held" : "";
  const red = card.suit === "♥" || card.suit === "♦" ? " red" : "";
  return `<button class="card poker-card${red}${held}" type="button" data-card-index="${index}" aria-pressed="${poker.holds[index]}"><span>${card.rank}</span><span>${card.suit}</span><em>${poker.holds[index] ? "Held" : "Hold"}</em></button>`;
}

function dealBlackjack() {
  const bet = placeBet();
  if (!bet) return;
  beep();
  blackjack = { deck: createDeck(), player: [], dealer: [], bet, active: true, holeHidden: true };
  blackjack.player.push(blackjack.deck.pop(), blackjack.deck.pop());
  blackjack.dealer.push(blackjack.deck.pop(), blackjack.deck.pop());
  els.dealBtn.disabled = true;
  els.hitBtn.disabled = false;
  els.standBtn.disabled = false;
  renderBlackjack();

  if (handValue(blackjack.player) === 21) {
    finishBlackjack("blackjack");
  } else {
    setMessage("Blackjack dealt. Hit or stand.");
  }
  render();
}

function hitBlackjack() {
  if (!blackjack.active) return;
  beep();
  blackjack.player.push(blackjack.deck.pop());
  renderBlackjack();
  if (handValue(blackjack.player) > 21) {
    finishBlackjack("bust");
  }
}

function standBlackjack() {
  if (!blackjack.active) return;
  beep();
  blackjack.holeHidden = false;
  while (handValue(blackjack.dealer) < 17) {
    blackjack.dealer.push(blackjack.deck.pop());
  }
  finishBlackjack("stand");
}

function finishBlackjack(reason) {
  blackjack.active = false;
  blackjack.holeHidden = false;
  els.dealBtn.disabled = false;
  els.hitBtn.disabled = true;
  els.standBtn.disabled = true;

  const player = handValue(blackjack.player);
  const dealer = handValue(blackjack.dealer);
  let payout = 0;
  let text = "";
  let outcome = "loss";

  if (reason === "blackjack") {
    payout = Math.floor(blackjack.bet * 2.5);
    text = `Blackjack! You won ${money(payout)}.`;
    outcome = "win";
  } else if (reason === "bust") {
    text = `You busted with ${player}. You lost ${money(blackjack.bet)}.`;
  } else if (dealer > 21 || player > dealer) {
    payout = blackjack.bet * 2;
    text = `You beat the dealer ${player} to ${dealer}. You won ${money(payout)}.`;
    outcome = "win";
  } else if (player === dealer) {
    payout = blackjack.bet;
    text = `Push at ${player}. Your ${money(blackjack.bet)} bet was returned.`;
    outcome = "push";
  } else {
    text = `Dealer wins ${dealer} to ${player}. You lost ${money(blackjack.bet)}.`;
  }

  pay(payout);
  beep(outcome === "win" ? "win" : "lose");
  setMessage(text);
  addHistory(`Blackjack: ${text}`, outcome);
  renderBlackjack();
  render();
}

function spinRoulette() {
  const bet = placeBet();
  if (!bet) return;
  beep();
  els.rouletteSpinBtn.disabled = true;
  const number = randomInt(0, 36);
  const activeChoice = document.querySelector("[data-roulette].active").dataset.roulette;
  const targetNumber = Math.max(0, Math.min(36, Math.floor(Number(els.rouletteNumber.value) || 0)));
  const rotation = 720 + number * 37 + randomInt(0, 20);
  els.rouletteWheel.style.transform = `rotate(${rotation}deg)`;

  setTimeout(() => {
    els.rouletteResult.textContent = number;
    const color = number === 0 ? "green" : redNumbers.has(number) ? "red" : "black";
    const evenOdd = number !== 0 && number % 2 === 0 ? "even" : number !== 0 ? "odd" : "zero";
    let won = false;
    let payout = 0;

    if (activeChoice === "number") {
      won = number === targetNumber;
      payout = won ? bet * 36 : 0;
    } else {
      won = activeChoice === color || activeChoice === evenOdd;
      payout = won ? bet * 2 : 0;
    }

    if (won) {
      pay(payout);
      beep("win");
      setMessage(`Roulette landed on ${number} ${color}. Your ${activeChoice} bet won ${money(payout)}.`);
      addHistory(`Roulette: ${number} ${color} won ${money(payout)}`, "win");
    } else {
      beep("lose");
      setMessage(`Roulette landed on ${number} ${color}. You lost ${money(bet)}.`);
      addHistory(`Roulette: ${number} ${color} lost ${money(bet)}`, "loss");
    }
    els.rouletteSpinBtn.disabled = false;
    render();
  }, 950);
}

function rollCraps() {
  let bet = craps.point ? craps.bet : placeBet();
  if (!bet) return;
  if (!craps.point) craps.bet = bet;
  beep();
  els.rollBtn.disabled = true;
  els.dieA.classList.add("rolling");
  els.dieB.classList.add("rolling");

  setTimeout(() => {
    const a = randomInt(1, 6);
    const b = randomInt(1, 6);
    const total = a + b;
    els.dieA.textContent = a;
    els.dieB.textContent = b;
    els.dieA.classList.remove("rolling");
    els.dieB.classList.remove("rolling");
    settleCraps(total, bet);
    els.rollBtn.disabled = false;
    render();
  }, 520);
}

function settleCraps(total, bet) {
  if (!craps.point) {
    if (total === 7 || total === 11) {
      const payout = bet * 2;
      pay(payout);
      beep("win");
      setMessage(`Come-out ${total}. Pass line wins ${money(payout)}.`);
      addHistory(`Craps: come-out ${total} won ${money(payout)}`, "win");
      craps.bet = 0;
    } else if ([2, 3, 12].includes(total)) {
      beep("lose");
      setMessage(`Come-out ${total}. Pass line loses ${money(bet)}.`);
      addHistory(`Craps: come-out ${total} lost ${money(bet)}`, "loss");
      craps.bet = 0;
    } else {
      craps.point = total;
      setMessage(`${total} is the point. Roll ${total} before 7 to win.`);
      addHistory(`Craps: point set to ${total}`, "push");
    }
  } else if (total === craps.point) {
    const payout = craps.bet * 2;
    pay(payout);
    beep("win");
    setMessage(`Point hit at ${total}. You won ${money(payout)}.`);
    addHistory(`Craps: point ${total} won ${money(payout)}`, "win");
    craps.point = 0;
    craps.bet = 0;
  } else if (total === 7) {
    beep("lose");
    setMessage(`Seven-out. You lost ${money(craps.bet)}.`);
    addHistory(`Craps: seven-out lost ${money(craps.bet)}`, "loss");
    craps.point = 0;
    craps.bet = 0;
  } else {
    setMessage(`Rolled ${total}. Point is still ${craps.point}.`);
  }

  els.crapsPoint.textContent = craps.point || "Off";
  els.crapsHint.textContent = craps.point
    ? `Roll ${craps.point} before 7. Your original pass-line bet remains live.`
    : "Come-out roll: 7 or 11 wins, 2, 3, or 12 loses.";
}

function dealBaccarat() {
  const bet = placeBet();
  if (!bet) return;
  beep();
  els.baccaratDealBtn.disabled = true;
  const deck = createDeck();
  const player = [deck.pop(), deck.pop()];
  const banker = [deck.pop(), deck.pop()];
  let playerThird = null;
  let bankerThird = null;
  let playerTotal = baccaratTotal(player);
  let bankerTotal = baccaratTotal(banker);

  if (playerTotal < 8 && bankerTotal < 8) {
    if (playerTotal <= 5) {
      playerThird = deck.pop();
      player.push(playerThird);
      playerTotal = baccaratTotal(player);
    }

    if (!playerThird) {
      if (bankerTotal <= 5) banker.push(deck.pop());
    } else {
      const third = baccaratValue(playerThird);
      if (
        bankerTotal <= 2 ||
        (bankerTotal === 3 && third !== 8) ||
        (bankerTotal === 4 && third >= 2 && third <= 7) ||
        (bankerTotal === 5 && third >= 4 && third <= 7) ||
        (bankerTotal === 6 && third >= 6 && third <= 7)
      ) {
        bankerThird = deck.pop();
        banker.push(bankerThird);
      }
    }
  }

  playerTotal = baccaratTotal(player);
  bankerTotal = baccaratTotal(banker);
  renderBaccarat(player, banker);
  settleBaccarat(bet, playerTotal, bankerTotal);
  els.baccaratDealBtn.disabled = false;
  render();
}

function renderBaccarat(player, banker) {
  els.baccaratPlayerCards.innerHTML = player.map(renderCard).join("");
  els.baccaratBankerCards.innerHTML = banker.map(renderCard).join("");
  els.baccaratPlayerScore.textContent = baccaratTotal(player);
  els.baccaratBankerScore.textContent = baccaratTotal(banker);
}

function settleBaccarat(bet, playerTotal, bankerTotal) {
  const selected = document.querySelector("[data-baccarat].active").dataset.baccarat;
  const result = playerTotal > bankerTotal ? "player" : bankerTotal > playerTotal ? "banker" : "tie";
  let payout = 0;

  if (selected === result && result === "tie") payout = bet * 9;
  else if (selected === result && result === "banker") payout = Math.floor(bet * 1.95);
  else if (selected === result) payout = bet * 2;

  if (payout > 0) {
    pay(payout);
    beep("win");
    setMessage(`Baccarat ${result} wins ${playerTotal} to ${bankerTotal}. Your ${selected} bet won ${money(payout)}.`);
    addHistory(`Baccarat: ${result} ${playerTotal}-${bankerTotal} won ${money(payout)}`, "win");
  } else {
    beep("lose");
    setMessage(`Baccarat ${result} wins ${playerTotal} to ${bankerTotal}. You lost ${money(bet)}.`);
    addHistory(`Baccarat: ${result} ${playerTotal}-${bankerTotal} lost ${money(bet)}`, "loss");
  }
}

function dealPoker() {
  const bet = placeBet();
  if (!bet) return;
  beep();
  poker = { deck: createDeck(), hand: [], holds: [false, false, false, false, false], bet, active: true };
  poker.hand = Array.from({ length: 5 }, () => poker.deck.pop());
  renderPoker();
  els.pokerDealBtn.disabled = true;
  els.pokerDrawBtn.disabled = false;
  setMessage("Video poker dealt. Hold the cards you want, then draw.");
  render();
}

function drawPoker() {
  if (!poker.active) return;
  beep();
  poker.hand = poker.hand.map((card, index) => (poker.holds[index] ? card : poker.deck.pop()));
  poker.active = false;
  renderPoker();
  settlePoker();
  els.pokerDealBtn.disabled = false;
  els.pokerDrawBtn.disabled = true;
  render();
}

function renderPoker() {
  els.pokerCards.innerHTML = poker.hand.map(renderPokerCard).join("");
  els.pokerCards.querySelectorAll(".poker-card").forEach((card) => {
    card.addEventListener("click", () => {
      if (!poker.active) return;
      const index = Number(card.dataset.cardIndex);
      poker.holds[index] = !poker.holds[index];
      renderPoker();
      beep();
    });
  });
}

function settlePoker() {
  const result = evaluatePoker(poker.hand);
  const payout = poker.bet * result.multiplier;

  if (payout > 0) {
    pay(payout);
    beep("win");
    setMessage(`${result.name}. You won ${money(payout)}.`);
    addHistory(`Poker: ${result.name} won ${money(payout)}`, "win");
  } else {
    beep("lose");
    setMessage(`${result.name}. You lost ${money(poker.bet)}.`);
    addHistory(`Poker: ${result.name} lost ${money(poker.bet)}`, "loss");
  }
}

function evaluatePoker(hand) {
  const values = hand.map((card) => ranks.indexOf(card.rank) + 1).sort((a, b) => a - b);
  const counts = values.reduce((map, value) => map.set(value, (map.get(value) || 0) + 1), new Map());
  const groups = [...counts.values()].sort((a, b) => b - a);
  const flush = hand.every((card) => card.suit === hand[0].suit);
  const unique = [...new Set(values)];
  const lowStraight = unique.join(",") === "1,2,3,4,5";
  const highStraight = unique.length === 5 && unique[4] - unique[0] === 4;
  const broadway = unique.join(",") === "1,10,11,12,13";
  const straight = lowStraight || highStraight || broadway;
  const pairRank = [...counts.entries()].find(([, count]) => count === 2)?.[0] || 0;

  if (flush && broadway) return { name: "Royal flush", multiplier: 250 };
  if (flush && straight) return { name: "Straight flush", multiplier: 50 };
  if (groups[0] === 4) return { name: "Four of a kind", multiplier: 25 };
  if (groups[0] === 3 && groups[1] === 2) return { name: "Full house", multiplier: 9 };
  if (flush) return { name: "Flush", multiplier: 6 };
  if (straight) return { name: "Straight", multiplier: 4 };
  if (groups[0] === 3) return { name: "Three of a kind", multiplier: 3 };
  if (groups[0] === 2 && groups[1] === 2) return { name: "Two pair", multiplier: 2 };
  if (groups[0] === 2 && (pairRank === 1 || pairRank >= 11)) return { name: "Jacks or better", multiplier: 1 };
  return { name: "No paying hand", multiplier: 0 };
}

function celebrate() {
  const width = (els.canvas.width = window.innerWidth);
  const height = (els.canvas.height = window.innerHeight);
  const pieces = Array.from({ length: 70 }, () => ({
    x: Math.random() * width,
    y: -20 - Math.random() * height * 0.3,
    vx: -2 + Math.random() * 4,
    vy: 2 + Math.random() * 4,
    size: 4 + Math.random() * 7,
    color: ["#f3c35b", "#5aa7ff", "#d84c45", "#62d98a"][randomInt(0, 3)],
    spin: Math.random() * Math.PI
  }));
  let frame = 0;

  function draw() {
    ctx.clearRect(0, 0, width, height);
    pieces.forEach((piece) => {
      piece.x += piece.vx;
      piece.y += piece.vy;
      piece.spin += 0.1;
      ctx.save();
      ctx.translate(piece.x, piece.y);
      ctx.rotate(piece.spin);
      ctx.fillStyle = piece.color;
      ctx.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size * 0.65);
      ctx.restore();
    });
    frame += 1;
    if (frame < 120) requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, width, height);
  }
  draw();
}

els.tabs.forEach((tab) => tab.addEventListener("click", () => switchGame(tab.dataset.game)));
els.chips.forEach((chip) => chip.addEventListener("click", () => {
  els.betAmount.value = chip.dataset.chip;
  beep();
}));
els.maxBetBtn.addEventListener("click", () => {
  els.betAmount.value = Math.max(1, state.balance);
  beep();
});
els.resetBtn.addEventListener("click", () => {
  Object.assign(state, { balance: STARTING_BALANCE, wagered: 0, won: 0, gamesPlayed: 0, bestWin: 0, history: [] });
  blackjack = { deck: [], player: [], dealer: [], bet: 0, active: false, holeHidden: true };
  craps = { point: 0, bet: 0 };
  poker = { deck: [], hand: [], holds: [], bet: 0, active: false };
  els.dealerCards.innerHTML = "";
  els.playerCards.innerHTML = "";
  els.baccaratPlayerCards.innerHTML = "";
  els.baccaratBankerCards.innerHTML = "";
  els.pokerCards.innerHTML = "";
  els.dealerScore.textContent = "0";
  els.playerScore.textContent = "0";
  els.baccaratPlayerScore.textContent = "0";
  els.baccaratBankerScore.textContent = "0";
  els.crapsPoint.textContent = "Off";
  els.crapsHint.textContent = "Come-out roll: 7 or 11 wins, 2, 3, or 12 loses.";
  els.pokerDealBtn.disabled = false;
  els.pokerDrawBtn.disabled = true;
  setMessage("Fresh bankroll loaded. Good luck.");
  render();
});
els.muteBtn.addEventListener("click", () => {
  muted = !muted;
  els.muteBtn.textContent = muted ? "×" : "♪";
});
els.spinBtn.addEventListener("click", spinSlots);
els.dealBtn.addEventListener("click", dealBlackjack);
els.hitBtn.addEventListener("click", hitBlackjack);
els.standBtn.addEventListener("click", standBlackjack);
els.rouletteChoices.forEach((choice) => choice.addEventListener("click", () => {
  els.rouletteChoices.forEach((item) => item.classList.remove("active"));
  choice.classList.add("active");
  els.rouletteNumber.disabled = choice.dataset.roulette !== "number";
  beep();
}));
els.rouletteSpinBtn.addEventListener("click", spinRoulette);
els.rollBtn.addEventListener("click", rollCraps);
els.baccaratChoices.forEach((choice) => choice.addEventListener("click", () => {
  els.baccaratChoices.forEach((item) => item.classList.remove("active"));
  choice.classList.add("active");
  beep();
}));
els.baccaratDealBtn.addEventListener("click", dealBaccarat);
els.pokerDealBtn.addEventListener("click", dealPoker);
els.pokerDrawBtn.addEventListener("click", drawPoker);
window.addEventListener("resize", () => {
  els.canvas.width = window.innerWidth;
  els.canvas.height = window.innerHeight;
});

els.rouletteNumber.disabled = true;
render();
