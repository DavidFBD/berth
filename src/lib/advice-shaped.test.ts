import { describe, expect, it } from "vitest";
import { adviceShaped, normaliseForAdvice } from "@/lib/advice-shaped";

/**
 * The contract for the gate beside Buy (lib/advice-shaped): every advice
 * shaped line below is dropped, every factual one kept. Real formats from
 * Nasdaq's feeds (The Motley Fool, Zacks, TipRanks, Benzinga, InvestorPlace)
 * and the desks the X column follows.
 */

const ADVICE = [
  // ratings and analyst actions
  "NVIDIA (NVDA) Gets a Hold from Bernstein",
  "Analyst Reiterates Buy on Apple",
  "Tesla Initiated With Buy at Mizuho",
  "Apple Rated Strong Buy",
  "Morgan Stanley Upgrades Apple to Overweight",
  "Goldman Downgrades Tesla to Neutral",
  "Jefferies Maintains Outperform on Nvidia",
  "Barclays Starts Coverage of Palantir at Underweight",
  "Microsoft Earns Buy Rating From Wedbush",
  "Is NVIDIA (NVDA) a Buy? Zacks Rank Says So",
  "AMD Stock: Analysts See Strong Buy Ahead of Earnings",
  "Wall Street Is Bullish on Amazon After the Event",
  "Tesla stock receives a sell rating from UBS",
  "Coinbase Cut to Underperform at Bank of America",
  // price targets
  "Morgan Stanley Raises Nvidia PT to $250",
  "Goldman lifts Apple target to $300",
  "Nvidia price objective raised at BofA",
  "Analyst Raises Nvidia Price Target to $250",
  "Tesla Fair Value Estimate Lifted by Morningstar",
  "Wedbush boosts Tesla to $500 on robotaxi",
  "Apple Could Hit $400 by 2027, Analyst Says",
  // imperatives
  "BUY NVIDIA NOW",
  "Buy Nvidia ahead of earnings",
  "Jim Cramer Says Buy Nvidia",
  "Cramer tells viewers to own Apple",
  "Avoid Tesla Until the Dust Settles",
  "Dump Intel, Grab AMD Instead",
  "Buy the Dip in Micron",
  "Steer clear of Coinbase this quarter",
  // listicles and formats
  "Better Buy: Nvidia vs. AMD",
  "2 Reasons to Buy Nvidia Stock",
  "3 Chip Stocks to Watch",
  "Where Will Nvidia Stock Be in 5 Years",
  "I'm Buying Nvidia Hand Over Fist",
  "Nvidia: Time To Load Up",
  "Don't Miss This AI Stock",
  "The Best Stock to Own for the Next Decade",
  "This Magnificent AI Stock Is a No-Brainer",
  "Here's Why Tesla Fell Today",
  "Here’s Why Nvidia Stock Is Soaring",
  "Is It Too Late to Buy Palantir Stock",
  "This Stock Could Make You a Millionaire",
  "If You Invested $1,000 in Nvidia a Decade Ago, This Is How Much You'd Have",
  "Top Pick for 2027: Amazon",
  "5 Dividend Stocks for Your Portfolio",
  "What Investors Need to Know About Apple's Event",
  "Why I Just Bought More Tesla",
  "One Unstoppable Stock to Hold Forever",
  // forecasts and valuation calls
  "Nvidia Is Undervalued",
  "Apple Stock Looks Cheap Right Now",
  "Tesla Could Rally 40%, Analyst Says",
  "Analyst Sees 30% Upside in Micron",
  "Palantir Is Overvalued, Short Seller Argues",
  "Nvidia Stock Price Prediction for 2030",
  "Amazon Shares Poised to Surge After Earnings",
  "Micron Will Double From Here",
  "Intel May Crash Further",
  "AMD is a bargain at these levels",
  "Strategy shares set to rebound, desk says",
  "Bearish Bets Pile Up on Tesla",
  // questions
  "Should You Buy Nvidia Stock Before Its Next Earnings Report?",
  "Is Now the Time to Buy Apple?",
  "Can Tesla Reach a $2 Trillion Valuation?",
  "Ryan Cohen buys $26.4M of GameStop. Is GME Now a Buy?",
  "Buy Tesla Before the Robotaxi Event?",
  // the delta red team's misses, 2026-10-01
  "Nvidia Is the Next Amazon, and It's Not Close",
  "The Next Nvidia Could Be This Little-Known Chipmaker",
  "Why Nvidia Is a Generational Opportunity",
  "Nvidia, a stock for the next decade",
  "Apple: A Long-Term Winner",
  "NVIDIA!!! WAGMI",
  "The Bull Case for Palantir",
  "The Bear Case for Tesla Nobody Talks About",
  "GameStop Short Squeeze Incoming",
  "AMC to the Moon",
  "NVDA 10x from here",
  "Palantir Stock Is Headed Higher",
  "Tesla Stock Is Headed for $1,000",
  "Barron's: Apple Stock Has Room to Run",
  "Nvidia Shares Have Further to Go, Says Barron's",
  "Nvidia: Expect Big Gains",
  "Seeking Alpha: Nvidia Earnings Preview, Expect a Beat",
  "Zacks Earnings ESP Points to a Beat for Apple",
  "Nvidia Could Gain 50% Says Top Analyst",
  "Nvidia Is Still a Gift at These Prices",
  "Nvidia Sell-Off Is a Gift",
  "Apple shares look attractive",
  "Apple is a strong hold",
  "Nvidia Gets the Nod From Goldman",
  "Goldman Adds Nvidia to Conviction List",
  "Tesla Removed From Focus List",
  "Jim Cramer Likes Nvidia",
  "Cramer: Own Nvidia, Don't Trade It",
  "Cramer's Lightning Round: Nvidia Is a Keeper",
  "Mad Money: Stick With Apple",
  "Nvidia Remains My Largest Position",
  "Nvidia Remains a Core Holding",
  "Load the boat on NVDA",
  "Accumulating NVDA under 120",
  "Koop Nvidia nu",
  "Analisten: Nvidia aandeel kopen",
  "Kaufempfehlung f\u00fcr Nvidia",
  "Nvidia-Aktie: Jetzt kaufen",
  "Kursziel f\u00fcr Nvidia angehoben",
  "Koersdoel Nvidia verhoogd naar 250 dollar",
  // carve-out abuse: a deal's verbs used for a call
  "Buy back into Nvidia now",
  "Cramer plans to buy more Nvidia",
  "Cathie Wood moves to buy Nvidia; you should too",
  "Retail investors set to buy the Nvidia pullback",
  "Analyst agrees: buy Nvidia",
  // X style, the kind of post a move could have pointed at
  "$NVDA to the moon \u{1F680}\u{1F680}",
  "$NVDA \u{1F680} LFG",
  "Loaded more $TSLA today. Not financial advice.",
  "Added to my $AAPL position this morning",
  "$NVDA breakout confirmed, next stop 200",
  "Long $NVDA into earnings",
  "Going long $TSLA calls",
  "$PLTR calls printing, send it",
  "Nvidia just broke out. 150 next.",
  "Opened a position in $NVDA",
  "$NVDA is the trade of the decade",
  "Shorting $TSLA here",
  // relayed predictions, from the x-autopost review 2026-10-05
  "Elon Musk says Tesla will be worth more than Apple and Microsoft combined",
  "Analyst says Nvidia will hit a $10 trillion market value by 2030",
  "Palantir will reach a trillion dollars, says fund manager",
  "Cathie Wood says Tesla will double again",
  "Apple will overtake Microsoft as the most valuable company, investor says",
];

const FACTS = [
  "Apple reports fourth quarter revenue of $102 billion",
  "Nvidia agrees to supply chips for OpenAI's new data centres",
  "Tesla delivered 497,000 vehicles in the third quarter",
  "S&P 500 closes at a record as rate cut hopes build",
  "Nvidia sees third quarter revenue of $54 billion, plus or minus 2%",
  "Microsoft expects Azure growth of 37% next quarter",
  "Apple launches iPhone 18 with new A20 chip",
  "Apple launches a cheaper iPhone for emerging markets",
  "Tesla begins robotaxi service in Austin",
  "Microsoft agrees to buy cybersecurity firm for $2 billion",
  "Amazon completes acquisition of a robotics startup",
  "Alphabet announces $70 billion share buyback",
  "EU fines Apple 500 million euros under the Digital Markets Act",
  "SEC approves spot ether ETFs",
  "FTC sues Amazon over Prime cancellations",
  "Intel names new chief executive",
  "Tesla's chief financial officer steps down",
  "Meta to hold its annual shareholder meeting on May 28",
  "Coinbase lists new token after review",
  "Fed cuts rates by a quarter point",
  "Oil climbs 3% after OPEC agrees output cut",
  "Micron shares rise 6% after results beat estimates",
  "Palantir wins $10 billion US Army contract",
  "TSMC monthly sales rise 40% from a year earlier",
  "Circle files for initial public offering",
  "Strategy acquires 4,225 bitcoin for $472 million",
  "Nasdaq sell-off deepens as yields climb",
  "Nvidia Blackwell delivers 30x faster inference, company says",
  "Alibaba to sell its stake in a department store chain",
  // from the delta red team's factual list, kept
  "Apple to buy back $110 billion of its shares",
  "Tesla CEO sells shares under a prearranged plan",
  "Microsoft raises its quarterly dividend by 10%",
  "Nvidia board approves a ten for one stock split",
  "SpaceX Starship lands on its second try",
  "Apple to hold its annual investor meeting in March",
  "Apple says it will open its first store in Mumbai next month",
  "Tesla will hold its annual shareholder meeting in November",
];

describe("adviceShaped", () => {
  it(`drops every advice shaped line (${ADVICE.length})`, () => {
    const kept = ADVICE.filter((line) => !adviceShaped(line));
    expect(kept).toEqual([]);
  });

  it(`keeps every factual line (${FACTS.length})`, () => {
    const dropped = FACTS.filter((line) => adviceShaped(line));
    expect(dropped).toEqual([]);
  });

  it("holds the corpus at its agreed size", () => {
    expect(ADVICE.length).toBeGreaterThanOrEqual(120);
    expect(FACTS.length).toBeGreaterThanOrEqual(25);
  });

  it("reads curly quotes, odd spacing and case as one spelling", () => {
    expect(normaliseForAdvice("  Here’s   WHY Nvidia ")).toBe("here's why nvidia");
    expect(adviceShaped("HERE’S WHY NVIDIA STOCK IS SOARING")).toBe(true);
  });
});
