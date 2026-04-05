/**
 * AI Move Scoring Engine for Gen 4 Trainer AI
 *
 * Implements the move scoring logic described in gen4_trainer_ai.md.
 * Each trainer has a set of 11 AI flags. When the AI selects a move, it starts
 * each move at score 100 and applies modifiers per active flag.
 *
 * Scores within a single flag are NOT cumulative (first matching condition wins),
 * but scores across different flags ARE cumulative.
 *
 * For probabilistic checks, we use the expected value (probability * modifier).
 * e.g. "50% chance of +2" -> expected +1.0
 *      "80.5% chance of -3" -> expected -2.415
 *      "92.2% chance of +3" -> expected +2.766
 *
 * Known limitations (cannot be tracked in a calculator):
 * - Stat stage data (assumed +0 for all stats)
 * - "Last move used" by either side
 * - Whether a mon is already statused/confused/seeded/substituted
 * - Whether screens/hazards are already active
 * - Protect chain count
 * - PP remaining
 * - Whether this is a switch-in's first turn vs. mid-battle
 * For switch-in predictions, we assume: first turn, full HP, no boosts, no status.
 */

// ============================================================================
// MOVE EFFECT CLASSIFICATION
// ============================================================================

var AI_MOVE_EFFECT = {
	// ---- Sleep ----
	"Spore":           { effect: "SLEEP" },
	"Sleep Powder":    { effect: "SLEEP" },
	"Hypnosis":        { effect: "SLEEP" },
	"Sing":            { effect: "SLEEP" },
	"GrassWhistle":    { effect: "SLEEP" },
	"Grass Whistle":   { effect: "SLEEP" },
	"Dark Void":       { effect: "SLEEP" },
	"Lovely Kiss":     { effect: "SLEEP" },
	"Yawn":            { effect: "YAWN" },
	"Rest":            { effect: "REST" },

	// ---- Poison ----
	"Poison Powder":   { effect: "POISON" },
	"Poison Gas":      { effect: "POISON" },
	"Toxic":           { effect: "TOXIC" },
	"Toxic Spikes":    { effect: "TOXIC_SPIKES" },

	// ---- Paralysis ----
	"Thunder Wave":    { effect: "PARALYZE" },
	"Stun Spore":      { effect: "PARALYZE" },
	"Glare":           { effect: "PARALYZE" },

	// ---- Burn ----
	"Will-O-Wisp":     { effect: "BURN" },

	// ---- Confusion ----
	"Confuse Ray":     { effect: "CONFUSE" },
	"Supersonic":      { effect: "CONFUSE" },
	"Sweet Kiss":      { effect: "CONFUSE" },
	"Teeter Dance":    { effect: "CONFUSE" },
	"Swagger":         { effect: "SWAGGER" },
	"Flatter":         { effect: "FLATTER" },

	// ---- Attract ----
	"Attract":         { effect: "ATTRACT" },

	// ---- Self-Destruct / Explosion ----
	"Self-Destruct":   { effect: "SELF_DESTRUCT" },
	"Explosion":       { effect: "SELF_DESTRUCT" },

	// ---- Nightmare / Dream Eater ----
	"Nightmare":       { effect: "NIGHTMARE" },
	"Dream Eater":     { effect: "DREAM_EATER" },

	// ---- Belly Drum ----
	"Belly Drum":      { effect: "BELLY_DRUM" },

	// ---- Stat boosting - attacking ----
	"Swords Dance":    { effect: "STAT_BOOST_ATK", stat: "atk", stages: 2 },
	"Nasty Plot":      { effect: "STAT_BOOST_ATK", stat: "spa", stages: 2 },
	"Howl":            { effect: "STAT_BOOST_ATK", stat: "atk", stages: 1 },
	"Meditate":        { effect: "STAT_BOOST_ATK", stat: "atk", stages: 1 },
	"Sharpen":         { effect: "STAT_BOOST_ATK", stat: "atk", stages: 1 },
	"Growth":          { effect: "STAT_BOOST_ATK", stat: "spa", stages: 1 },
	"Tail Glow":       { effect: "STAT_BOOST_ATK", stat: "spa", stages: 2 },

	// ---- Stat boosting - defending ----
	"Amnesia":         { effect: "STAT_BOOST_DEF", stat: "spd", stages: 2 },
	"Iron Defense":    { effect: "STAT_BOOST_DEF", stat: "def", stages: 2 },
	"Acid Armor":      { effect: "STAT_BOOST_DEF", stat: "def", stages: 2 },
	"Barrier":         { effect: "STAT_BOOST_DEF", stat: "def", stages: 2 },
	"Withdraw":        { effect: "STAT_BOOST_DEF", stat: "def", stages: 1 },
	"Harden":          { effect: "STAT_BOOST_DEF", stat: "def", stages: 1 },
	"Defense Curl":    { effect: "STAT_BOOST_DEF", stat: "def", stages: 1 },
	"Stockpile":       { effect: "STOCKPILE" },

	// ---- Stat boosting - speed ----
	"Agility":         { effect: "STAT_BOOST_SPE", stat: "spe", stages: 2 },
	"Rock Polish":     { effect: "STAT_BOOST_SPE", stat: "spe", stages: 2 },
	"Autotomize":      { effect: "STAT_BOOST_SPE", stat: "spe", stages: 2 },

	// ---- Stat boosting - evasion ----
	"Double Team":     { effect: "STAT_BOOST_EVA", stat: "eva", stages: 1 },
	"Minimize":        { effect: "STAT_BOOST_EVA", stat: "eva", stages: 1 },

	// ---- Acupressure ----
	"Acupressure":     { effect: "ACUPRESSURE" },

	// ---- Multi-stat boosters ----
	"Calm Mind":       { effect: "CALM_MIND" },
	"Dragon Dance":    { effect: "DRAGON_DANCE" },
	"Bulk Up":         { effect: "BULK_UP" },
	"Cosmic Power":    { effect: "COSMIC_POWER" },
	"Shell Smash":     { effect: "STAT_BOOST_ATK", stat: "atk", stages: 2 },

	// ---- Omni-boost (10% chance all stats +1) ----
	"Ancient Power":   { effect: "OMNI_BOOST" },
	"Silver Wind":     { effect: "OMNI_BOOST" },
	"Ominous Wind":    { effect: "OMNI_BOOST" },

	// ---- Stat dropping - attack ----
	"Growl":           { effect: "STAT_DROP_ATK", stat: "atk", stages: -1 },
	"Charm":           { effect: "STAT_DROP_ATK", stat: "atk", stages: -2 },
	"Feather Dance":   { effect: "STAT_DROP_ATK", stat: "atk", stages: -2 },

	// ---- Stat dropping - defense ----
	"Leer":            { effect: "STAT_DROP_DEF", stat: "def", stages: -1 },
	"Tail Whip":       { effect: "STAT_DROP_DEF", stat: "def", stages: -1 },
	"Screech":         { effect: "STAT_DROP_DEF", stat: "def", stages: -2 },

	// ---- Stat dropping - speed ----
	"Scary Face":      { effect: "STAT_DROP_SPE", stat: "spe", stages: -2 },
	"Cotton Spore":    { effect: "STAT_DROP_SPE", stat: "spe", stages: -2 },
	"String Shot":     { effect: "STAT_DROP_SPE", stat: "spe", stages: -1 },

	// ---- Stat dropping - accuracy ----
	"Sand Attack":     { effect: "STAT_DROP_ACC", stat: "acc", stages: -1 },
	"Smokescreen":     { effect: "STAT_DROP_ACC", stat: "acc", stages: -1 },
	"Flash":           { effect: "STAT_DROP_ACC", stat: "acc", stages: -1 },
	"Kinesis":         { effect: "STAT_DROP_ACC", stat: "acc", stages: -1 },

	// ---- Stat dropping - evasion ----
	"Sweet Scent":     { effect: "STAT_DROP_EVA", stat: "eva", stages: -1 },

	// ---- Stat dropping - spdef ----
	"Fake Tears":      { effect: "STAT_DROP_SPD", stat: "spd", stages: -2 },
	"Metal Sound":     { effect: "STAT_DROP_SPD", stat: "spd", stages: -2 },

	// ---- Stat dropping - spatk ----
	"Captivate":       { effect: "CAPTIVATE" },

	// ---- Multi-stat drop ----
	"Tickle":          { effect: "TICKLE" },
	"Memento":         { effect: "MEMENTO" },

	// ---- Special attack reducers (Overheat, Draco Meteor) ----
	"Overheat":        { effect: "REDUCE_SPATK" },
	"Draco Meteor":    { effect: "REDUCE_SPATK" },

	// ---- Haze / Psych Up / Heart Swap ----
	"Haze":            { effect: "HAZE" },
	"Psych Up":        { effect: "PSYCH_UP" },
	"Heart Swap":      { effect: "HEART_SWAP" },

	// ---- Recovery ----
	"Recover":         { effect: "RECOVERY" },
	"Milk Drink":      { effect: "RECOVERY" },
	"Softboiled":      { effect: "RECOVERY" },
	"Slack Off":       { effect: "RECOVERY" },
	"Roost":           { effect: "RECOVERY" },
	"Wish":            { effect: "RECOVERY" },
	"Synthesis":       { effect: "RECOVERY_WEATHER" },
	"Morning Sun":     { effect: "RECOVERY_WEATHER" },
	"Moonlight":       { effect: "RECOVERY_WEATHER" },
	"Swallow":         { effect: "SWALLOW" },
	"Ingrain":         { effect: "INGRAIN" },
	"Aqua Ring":       { effect: "AQUA_RING" },
	"Heal Bell":       { effect: "AROMATHERAPY" },
	"Aromatherapy":    { effect: "AROMATHERAPY" },
	"Refresh":         { effect: "REFRESH" },
	"Healing Wish":    { effect: "HEALING_WISH" },
	"Lunar Dance":     { effect: "LUNAR_DANCE" },
	"Pain Split":      { effect: "PAIN_SPLIT" },

	// ---- Screens / Safeguard / Mist ----
	"Reflect":         { effect: "REFLECT" },
	"Light Screen":    { effect: "LIGHT_SCREEN" },
	"Safeguard":       { effect: "SAFEGUARD" },
	"Mist":            { effect: "MIST" },

	// ---- Substitute ----
	"Substitute":      { effect: "SUBSTITUTE" },

	// ---- Switching moves ----
	"Baton Pass":      { effect: "BATON_PASS" },
	"U-turn":          { effect: "U_TURN" },
	"Volt Switch":     { effect: "U_TURN" },
	"Pursuit":         { effect: "PURSUIT" },

	// ---- Force switch ----
	"Roar":            { effect: "ROAR" },
	"Whirlwind":       { effect: "ROAR" },
	"Dragon Tail":     { effect: "ROAR_DAMAGE" },
	"Circle Throw":    { effect: "ROAR_DAMAGE" },

	// ---- Entry hazards ----
	"Spikes":          { effect: "SPIKES" },
	"Stealth Rock":    { effect: "STEALTH_ROCK" },

	// ---- Weather ----
	"Rain Dance":      { effect: "RAIN_DANCE" },
	"Sunny Day":       { effect: "SUNNY_DAY" },
	"Sandstorm":       { effect: "SANDSTORM" },
	"Hail":            { effect: "HAIL" },

	// ---- Trick Room / Gravity / Tailwind ----
	"Trick Room":      { effect: "TRICK_ROOM" },
	"Gravity":         { effect: "GRAVITY" },
	"Tailwind":        { effect: "TAILWIND" },

	// ---- Protect / Detect ----
	"Protect":         { effect: "PROTECT" },
	"Detect":          { effect: "PROTECT" },
	"Endure":          { effect: "ENDURE" },

	// ---- OHKO moves ----
	"Fissure":         { effect: "OHKO" },
	"Horn Drill":      { effect: "OHKO" },
	"Sheer Cold":      { effect: "OHKO" },
	"Guillotine":      { effect: "OHKO" },

	// ---- Leech Seed ----
	"Leech Seed":      { effect: "LEECH_SEED" },

	// ---- Disable / Encore ----
	"Disable":         { effect: "DISABLE" },
	"Encore":          { effect: "ENCORE" },

	// ---- Trapping ----
	"Mean Look":       { effect: "MEAN_LOOK" },
	"Spider Web":      { effect: "MEAN_LOOK" },
	"Block":           { effect: "MEAN_LOOK" },

	// ---- Perish Song / Torment / Taunt / Heal Block / Gastro Acid ----
	"Perish Song":     { effect: "PERISH_SONG" },
	"Torment":         { effect: "TORMENT" },
	"Taunt":           { effect: "TAUNT" },
	"Heal Block":      { effect: "HEAL_BLOCK" },
	"Gastro Acid":     { effect: "GASTRO_ACID" },

	// ---- Fake Out ----
	"Fake Out":        { effect: "FAKE_OUT" },

	// ---- Trick / Switcheroo / Knock Off ----
	"Trick":           { effect: "TRICK" },
	"Switcheroo":      { effect: "TRICK" },
	"Knock Off":       { effect: "KNOCK_OFF" },

	// ---- Imprison ----
	"Imprison":        { effect: "IMPRISON" },

	// ---- Snore / Sleep Talk ----
	"Snore":           { effect: "SLEEP_TALK" },
	"Sleep Talk":      { effect: "SLEEP_TALK" },

	// ---- Curse ----
	"Curse":           { effect: "CURSE" },

	// ---- Destiny Bond ----
	"Destiny Bond":    { effect: "DESTINY_BOND" },

	// ---- Counter / Mirror Coat / Metal Burst ----
	"Counter":         { effect: "COUNTER" },
	"Mirror Coat":     { effect: "MIRROR_COAT" },
	"Metal Burst":     { effect: "METAL_BURST" },

	// ---- Focus Energy ----
	"Focus Energy":    { effect: "FOCUS_ENERGY" },

	// ---- Magnet Rise ----
	"Magnet Rise":     { effect: "MAGNET_RISE" },

	// ---- Lucky Chant ----
	"Lucky Chant":     { effect: "LUCKY_CHANT" },

	// ---- Helping Hand ----
	"Helping Hand":    { effect: "HELPING_HAND" },

	// ---- Defog ----
	"Defog":           { effect: "DEFOG" },

	// ---- Power Trick ----
	"Power Trick":     { effect: "POWER_TRICK" },

	// ---- Charge turn moves ----
	"Razor Wind":      { effect: "CHARGE_TURN" },
	"Sky Attack":      { effect: "CHARGE_TURN" },
	"Skull Bash":      { effect: "CHARGE_TURN" },
	"Solar Beam":      { effect: "CHARGE_SOLAR" },
	"Fly":             { effect: "CHARGE_INVULN" },
	"Dig":             { effect: "CHARGE_INVULN" },
	"Dive":            { effect: "CHARGE_INVULN" },
	"Bounce":          { effect: "CHARGE_INVULN" },
	"Shadow Force":    { effect: "SHADOW_FORCE" },
	"Phantom Force":   { effect: "SHADOW_FORCE" },

	// ---- Recharge moves ----
	"Hyper Beam":      { effect: "RECHARGE" },
	"Giga Impact":     { effect: "RECHARGE" },
	"Blast Burn":      { effect: "RECHARGE" },
	"Frenzy Plant":    { effect: "RECHARGE" },
	"Hydro Cannon":    { effect: "RECHARGE" },
	"Roar of Time":    { effect: "RECHARGE" },
	"Rock Wrecker":    { effect: "RECHARGE" },
	"Prismatic Laser": { effect: "RECHARGE" },

	// ---- Focus Punch / Sucker Punch / Superpower ----
	"Focus Punch":     { effect: "FOCUS_PUNCH" },
	"Sucker Punch":    { effect: "SUCKER_PUNCH" },
	"Superpower":      { effect: "SUPERPOWER" },

	// ---- Close Combat / Hammer Arm ----
	"Close Combat":    { effect: "CLOSE_COMBAT" },
	"Hammer Arm":      { effect: "HAMMER_ARM" },

	// ---- Priority attacking moves ----
	"Quick Attack":    { effect: "PRIORITY_ATTACK", priority: 1 },
	"Mach Punch":      { effect: "PRIORITY_ATTACK", priority: 1 },
	"Bullet Punch":    { effect: "PRIORITY_ATTACK", priority: 1 },
	"Extreme Speed":   { effect: "PRIORITY_ATTACK", priority: 2 },
	"Aqua Jet":        { effect: "PRIORITY_ATTACK", priority: 1 },
	"Ice Shard":       { effect: "PRIORITY_ATTACK", priority: 1 },
	"Shadow Sneak":    { effect: "PRIORITY_ATTACK", priority: 1 },
	"Vacuum Wave":     { effect: "PRIORITY_ATTACK", priority: 1 },

	// ---- Accuracy-ignoring moves ----
	"Aerial Ace":      { effect: "ACCURACY_IGNORE" },
	"Shock Wave":      { effect: "ACCURACY_IGNORE" },
	"Magnet Bomb":     { effect: "ACCURACY_IGNORE" },
	"Swift":           { effect: "ACCURACY_IGNORE" },
	"Feint Attack":    { effect: "ACCURACY_IGNORE" },
	"Shadow Punch":    { effect: "ACCURACY_IGNORE" },
	"Aura Sphere":     { effect: "ACCURACY_IGNORE" },

	// ---- Vital Throw ----
	"Vital Throw":     { effect: "VITAL_THROW" },

	// ---- Variable power / flat damage ----
	"Bide":            { effect: "BIDE" },
	"Super Fang":      { effect: "SUPER_FANG" },
	"Dragon Rage":     { effect: "FLAT_DAMAGE" },
	"Night Shade":     { effect: "LEVEL_DAMAGE" },
	"Seismic Toss":    { effect: "LEVEL_DAMAGE" },
	"Psywave":         { effect: "PSYWAVE" },
	"Flail":           { effect: "FLAIL" },
	"Reversal":        { effect: "FLAIL" },
	"Return":          { effect: "VARIABLE_DAMAGE" },
	"Frustration":     { effect: "VARIABLE_DAMAGE" },
	"Present":         { effect: "PRESENT" },
	"Sonic Boom":      { effect: "FLAT_DAMAGE" },
	"Hidden Power":    { effect: "HIDDEN_POWER" },
	"Low Kick":        { effect: "VARIABLE_DAMAGE" },
	"Grass Knot":      { effect: "VARIABLE_DAMAGE" },
	"Gyro Ball":       { effect: "GYRO_BALL" },
	"Trump Card":      { effect: "TRUMP_CARD" },
	"Crush Grip":      { effect: "WRING_OUT" },
	"Wring Out":       { effect: "WRING_OUT" },
	"Punishment":      { effect: "PUNISHMENT" },
	"Magnitude":       { effect: "VARIABLE_DAMAGE" },
	"Endeavor":        { effect: "ENDEAVOR" },
	"Natural Gift":    { effect: "NATURAL_GIFT" },
	"Judgment":        { effect: "VARIABLE_DAMAGE" },
	"Water Spout":     { effect: "WATER_SPOUT" },
	"Eruption":        { effect: "WATER_SPOUT" },
	"Head Smash":      { effect: "RECOIL_HIGH" },

	// ---- Draining attacks ----
	"Giga Drain":      { effect: "DRAIN" },
	"Drain Punch":     { effect: "DRAIN" },
	"Absorb":          { effect: "DRAIN" },
	"Mega Drain":      { effect: "DRAIN" },
	"Leech Life":      { effect: "DRAIN" },
	"Horn Leech":      { effect: "DRAIN" },

	// ---- High crit rate ----
	"Slash":           { effect: "HIGH_CRIT" },
	"Karate Chop":     { effect: "HIGH_CRIT" },
	"Razor Leaf":      { effect: "HIGH_CRIT" },
	"Cross Poison":    { effect: "HIGH_CRIT" },
	"Stone Edge":      { effect: "HIGH_CRIT" },
	"Night Slash":     { effect: "HIGH_CRIT" },
	"Psycho Cut":      { effect: "HIGH_CRIT" },
	"Shadow Claw":     { effect: "HIGH_CRIT" },
	"Leaf Blade":      { effect: "HIGH_CRIT" },
	"Crabhammer":      { effect: "HIGH_CRIT" },
	"Air Cutter":      { effect: "HIGH_CRIT" },

	// ---- Recoil attacking moves ----
	"Double-Edge":     { effect: "RECOIL" },
	"Brave Bird":      { effect: "RECOIL" },
	"Flare Blitz":     { effect: "RECOIL" },
	"Volt Tackle":     { effect: "RECOIL" },
	"Wood Hammer":     { effect: "RECOIL" },
	"Submission":      { effect: "RECOIL" },
	"Take Down":       { effect: "RECOIL" },
	"Wild Charge":     { effect: "RECOIL" },

	// ---- Binding moves ----
	"Wrap":            { effect: "BINDING" },
	"Bind":            { effect: "BINDING" },
	"Clamp":           { effect: "BINDING" },
	"Fire Spin":       { effect: "BINDING" },
	"Sand Tomb":       { effect: "BINDING" },
	"Whirlpool":       { effect: "WHIRLPOOL" },
	"Magma Storm":     { effect: "BINDING" },

	// ---- Speed-lowering attacks ----
	"Rock Tomb":       { effect: "SPEED_DROP_ATTACK" },
	"Icy Wind":        { effect: "SPEED_DROP_ATTACK" },
	"Mud Shot":        { effect: "SPEED_DROP_ATTACK" },
	"Bulldoze":        { effect: "SPEED_DROP_ATTACK" },
	"Electroweb":      { effect: "SPEED_DROP_ATTACK" },

	// ---- Fling ----
	"Fling":           { effect: "FLING" },

	// ---- Psycho Shift ----
	"Psycho Shift":    { effect: "PSYCHO_SHIFT" },

	// ---- Worry Seed ----
	"Worry Seed":      { effect: "WORRY_SEED" },

	// ---- Mud Sport / Water Sport ----
	"Mud Sport":       { effect: "MUD_SPORT" },
	"Water Sport":     { effect: "WATER_SPORT" },

	// ---- Camouflage ----
	"Camouflage":      { effect: "CAMOUFLAGE" },

	// ---- Copycat ----
	"Copycat":         { effect: "COPYCAT" },

	// ---- Me First ----
	"Me First":        { effect: "ME_FIRST" },

	// ---- Mirror Move ----
	"Mirror Move":     { effect: "MIRROR_MOVE" },

	// ---- Power Swap / Guard Swap ----
	"Power Swap":      { effect: "POWER_SWAP" },
	"Guard Swap":      { effect: "GUARD_SWAP" },

	// ---- Last Resort ----
	"Last Resort":     { effect: "LAST_RESORT" },

	// ---- Embargo ----
	"Embargo":         { effect: "EMBARGO" },

	// ---- Conversion ----
	"Conversion":      { effect: "CONVERSION" },
	"Conversion 2":    { effect: "CONVERSION" },

	// ---- Lock On / Mind Reader ----
	"Lock-On":         { effect: "LOCK_ON" },
	"Lock On":         { effect: "LOCK_ON" },
	"Mind Reader":     { effect: "LOCK_ON" },

	// ---- Future Sight / Doom Desire ----
	"Future Sight":    { effect: "FUTURE_SIGHT" },
	"Doom Desire":     { effect: "FUTURE_SIGHT" },

	// ---- Spit Up ----
	"Spit Up":         { effect: "SPIT_UP" },

	// ---- Rapid Spin ----
	"Rapid Spin":      { effect: "RAPID_SPIN" },

	// ---- Foresight / Odor Sleuth / Miracle Eye ----
	"Foresight":       { effect: "FORESIGHT" },
	"Odor Sleuth":     { effect: "FORESIGHT" },
	"Miracle Eye":     { effect: "MIRACLE_EYE" },

	// ---- Skill Swap ----
	"Skill Swap":      { effect: "SKILL_SWAP" },

	// ---- Metronome ----
	"Metronome":       { effect: "METRONOME" },

	// ---- Spite ----
	"Spite":           { effect: "SPITE" },

	// ---- Thief / Covet ----
	"Thief":           { effect: "THIEF" },
	"Covet":           { effect: "THIEF" },

	// ---- Facade ----
	"Facade":          { effect: "FACADE" },

	// ---- Smelling Salts ----
	"Smelling Salts":  { effect: "SMELLING_SALT" },
	"SmellingSalt":    { effect: "SMELLING_SALT" },

	// ---- Wake-Up Slap ----
	"Wake-Up Slap":    { effect: "WAKE_UP_SLAP" },

	// ---- Brick Break ----
	"Brick Break":     { effect: "BRICK_BREAK" },

	// ---- Avalanche / Revenge ----
	"Avalanche":       { effect: "AVALANCHE" },
	"Revenge":         { effect: "AVALANCHE" },

	// ---- Brine ----
	"Brine":           { effect: "BRINE" },

	// ---- Payback ----
	"Payback":         { effect: "PAYBACK" },

	// ---- Assurance ----
	"Assurance":       { effect: "ASSURANCE" },

	// ---- Pluck / Bug Bite ----
	"Pluck":           { effect: "PLUCK" },
	"Bug Bite":        { effect: "PLUCK" },

	// ---- Feint ----
	"Feint":           { effect: "FEINT" },

	// ---- Follow Me ----
	"Follow Me":       { effect: "FOLLOW_ME" },

	// ---- Magic Coat ----
	"Magic Coat":      { effect: "MAGIC_COAT" },

	// ---- Recycle ----
	"Recycle":         { effect: "RECYCLE" },

	// ---- Snatch ----
	"Snatch":          { effect: "SNATCH" },

	// ---- Secret Power / Nature Power ----
	"Secret Power":    { effect: "SECRET_POWER" },
	"Nature Power":    { effect: "NATURE_POWER" },

	// ---- Blizzard ----
	"Blizzard":        { effect: "BLIZZARD" }
};


// Moves the AI treats as "non-standard damage" (score 0 base for Evaluate Attack)
var AI_NONSTD_DAMAGE_MOVES = {
	"Self-Destruct": 1, "Explosion": 1,
	"Dream Eater": 1,
	"Razor Wind": 1, "Sky Attack": 1, "Skull Bash": 1, "Solar Beam": 1,
	"Hyper Beam": 1, "Giga Impact": 1, "Frenzy Plant": 1, "Blast Burn": 1, "Hydro Cannon": 1, "Roar of Time": 1, "Rock Wrecker": 1,
	"Water Spout": 1, "Eruption": 1,
	"Gyro Ball": 1, "Low Kick": 1, "Grass Knot": 1,
	"Head Smash": 1,
	"Night Shade": 1, "Seismic Toss": 1,
	"Return": 1, "Frustration": 1,
	"Dragon Rage": 1, "Sonic Boom": 1,
	"Spit Up": 1,
	"Focus Punch": 1, "Superpower": 1, "Sucker Punch": 1,
	"Hidden Power": 1, "Natural Gift": 1, "Judgment": 1, "Psywave": 1
};

// Sound-based moves for Soundproof check
var AI_SOUND_MOVES = {
	"Bug Buzz": 1, "Chatter": 1, "Grass Whistle": 1, "GrassWhistle": 1,
	"Growl": 1, "Heal Bell": 1, "Hyper Voice": 1, "Metal Sound": 1,
	"Perish Song": 1, "Roar": 1, "Screech": 1, "Sing": 1, "Snore": 1,
	"Supersonic": 1, "Uproar": 1
};


// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function aiGetMoveData(moveName) {
	if (!moveName || moveName === "(No Move)") return null;
	if (typeof MOVES !== "undefined") {
		var id = moveName.toLowerCase().replace(/[\s\-]/g, "");
		var m = MOVES[id];
		if (m) {
			return {
				name: moveName,
				type: (m.type || "normal").toLowerCase(),
				bp: m.basePower || 0,
				category: m.category || "status",
				priority: m.priority || 0,
				target: m.target || "normal"
			};
		}
	}
	return null;
}

function aiGetEffectiveness(atkType, defTypes) {
	if (!atkType || !defTypes) return 1;
	var mult = 1;
	for (var i = 0; i < defTypes.length; i++) {
		if (!defTypes[i]) continue;
		var at = atkType.charAt(0).toUpperCase() + atkType.slice(1).toLowerCase();
		var dt = defTypes[i].charAt(0).toUpperCase() + defTypes[i].slice(1).toLowerCase();
		var key = at + "-" + dt;
		if (typeof TYPE_MATCHUPS !== "undefined" && key in TYPE_MATCHUPS) {
			mult *= TYPE_MATCHUPS[key];
		}
	}
	return mult;
}

function aiHasAbility(pokemon, abilityName) {
	if (!pokemon || !abilityName) return false;
	var ab = (pokemon.ability || "").toLowerCase();
	return ab === abilityName.toLowerCase();
}

function aiHasType(pokemon, typeName) {
	if (!pokemon || !typeName) return false;
	var types = pokemon.types || [];
	var t = typeName.toLowerCase();
	for (var i = 0; i < types.length; i++) {
		if ((types[i] || "").toLowerCase() === t) return true;
	}
	return false;
}

function aiGetTypes(pokemon) {
	if (!pokemon) return [];
	var types = pokemon.types || [];
	var result = [];
	for (var i = 0; i < types.length; i++) {
		if (types[i]) result.push(types[i].toLowerCase());
	}
	return result;
}

function aiCalcMaxDamage(attackerPoke, defenderPoke, moveName, fieldObj) {
	if (!moveName || moveName === "(No Move)") return 0;
	var mData = aiGetMoveData(moveName);
	if (!mData || mData.bp === 0) return 0;
	try {
		var moveObj = new calc.Move(gen, moveName, {
			ability: attackerPoke.ability,
			item: attackerPoke.item
		});
		var result = calc.calculate(gen, attackerPoke, defenderPoke, moveObj, fieldObj);
		if (result && result.damage) {
			if (Array.isArray(result.damage)) {
				return result.damage[result.damage.length - 1] || 0;
			}
			return result.damage;
		}
	} catch (e) {}
	return 0;
}

function aiKnowsMove(moveNames, targetMove) {
	if (!moveNames) return false;
	for (var i = 0; i < moveNames.length; i++) {
		if (moveNames[i] === targetMove) return true;
	}
	return false;
}

function aiKnowsAnyMove(moveNames, targetMoves) {
	for (var i = 0; i < targetMoves.length; i++) {
		if (aiKnowsMove(moveNames, targetMoves[i])) return true;
	}
	return false;
}

function aiHasDamagingMove(moveNames) {
	for (var i = 0; i < moveNames.length; i++) {
		var md = aiGetMoveData(moveNames[i]);
		if (md && md.bp > 0) return true;
	}
	return false;
}

function aiIsSuperEffective(moveName, defender) {
	var md = aiGetMoveData(moveName);
	if (!md || md.bp === 0) return false;
	return aiGetEffectiveness(md.type, aiGetTypes(defender)) >= 2;
}


// ============================================================================
// FLAG SCORING FUNCTIONS
// ============================================================================

/**
 * BASIC FLAG
 * Philosophy: Discourage wasted turns and moves that benefit the opponent.
 */
function scoreBasicFlag(moveName, mData, mEffect, attacker, defender, context) {
	var score = 0;
	var eff = mEffect ? mEffect.effect : null;
	var defTypes = aiGetTypes(defender);
	var defAbility = (defender.ability || "").toLowerCase();
	var atkAbility = (attacker.ability || "").toLowerCase();
	var isMoldBreaker = (atkAbility === "mold breaker");

	// Step 1: Type immunity check (for damaging moves)
	if (mData && mData.bp > 0) {
		var typeEff = aiGetEffectiveness(mData.type, defTypes);
		if (typeEff === 0) return -10;

		// Ability immunities
		if (!isMoldBreaker) {
			if (defAbility === "volt absorb" && mData.type === "electric") return -10;
			if (defAbility === "motor drive" && mData.type === "electric") return -10;
			if (defAbility === "water absorb" && mData.type === "water") return -10;
			if (defAbility === "flash fire" && mData.type === "fire") return -10;
			if (defAbility === "levitate" && mData.type === "ground") return -10;
			if (defAbility === "wonder guard" && typeEff <= 1) return -10;
			if (defAbility === "soundproof" && (moveName in AI_SOUND_MOVES)) return -10;
			// Note: Dry Skin absent from this check (documented AI bug)
		}
	}

	// Step 2: Score by effect
	switch (eff) {
		case "SLEEP":
		case "YAWN":
			// -10 if target has Insomnia/Vital Spirit
			if (defAbility === "insomnia" || defAbility === "vital spirit") score = -10;
			break;

		case "POISON":
		case "TOXIC":
			if (aiHasType(defender, "steel") || aiHasType(defender, "poison")) score = -10;
			else if (defAbility === "immunity" || defAbility === "magic guard" || defAbility === "poison heal") score = -10;
			break;

		case "PARALYZE":
			if (defAbility === "limber" || defAbility === "magic guard") score = -10;
			else if (moveName === "Thunder Wave") {
				if (!isMoldBreaker && (defAbility === "motor drive" || defAbility === "volt absorb")) score = -10;
				if (aiHasType(defender, "ground")) score = -10;
			}
			break;

		case "BURN":
			if (aiHasType(defender, "fire")) score = -10;
			else if (defAbility === "water veil" || defAbility === "magic guard") score = -10;
			break;

		case "CONFUSE":
		case "SWAGGER":
		case "FLATTER":
			if (defAbility === "own tempo") score = -10;
			break;

		case "ATTRACT":
			if (defAbility === "oblivious") score = -10;
			// Gender check: can't attract same gender or genderless
			else if (attacker.gender && defender.gender) {
				if (attacker.gender === defender.gender) score = -10;
			} else {
				score = -10; // genderless
			}
			break;

		case "SELF_DESTRUCT":
			var sdEff = aiGetEffectiveness("normal", defTypes);
			if (sdEff === 0) score = -10;
			else if (!isMoldBreaker && defAbility === "damp") score = -10;
			else if (context.attackerIsLast) score = -10;
			break;

		case "NIGHTMARE":
			if (defAbility === "magic guard") score = -10;
			// Target not asleep on switch-in
			else score = -10;
			break;

		case "DREAM_EATER":
			var deEff = aiGetEffectiveness("psychic", defTypes);
			if (deEff === 0) score = -10;
			// -8 if target not asleep (switch-ins are awake)
			else score = -8;
			break;

		case "BELLY_DRUM":
			if (context.attackerHPPercent < 51) score = -10;
			break;

		case "STAT_BOOST_ATK":
		case "STAT_BOOST_DEF":
		case "STAT_BOOST_SPE":
		case "STAT_BOOST_EVA":
			// At +0 default: no penalty
			break;

		case "STAT_DROP_ATK":
		case "STAT_DROP_DEF":
		case "STAT_DROP_SPE":
		case "STAT_DROP_ACC":
		case "STAT_DROP_EVA":
		case "STAT_DROP_SPD":
			if (!isMoldBreaker && (defAbility === "clear body" || defAbility === "white smoke")) score = -10;
			if ((eff === "STAT_DROP_ATK") && defAbility === "hyper cutter" && !isMoldBreaker) score = -10;
			if ((eff === "STAT_DROP_ACC") && defAbility === "keen eye" && !isMoldBreaker) score = -10;
			// Speed drop + Speed Boost
			if ((eff === "STAT_DROP_SPE") && defAbility === "speed boost") score = -10;
			break;

		case "TICKLE":
			if (!isMoldBreaker && (defAbility === "clear body" || defAbility === "white smoke")) score = -10;
			break;

		case "CAPTIVATE":
			if (!isMoldBreaker && (defAbility === "oblivious" || defAbility === "clear body" || defAbility === "white smoke")) score = -10;
			// Same gender / genderless
			if (attacker.gender && defender.gender) {
				if (attacker.gender === defender.gender) score = -10;
			} else {
				score = -10;
			}
			break;

		case "MEMENTO":
			if (!isMoldBreaker && (defAbility === "clear body" || defAbility === "white smoke")) score = -10;
			else if (context.attackerIsLast) score = -10;
			break;

		case "HAZE":
		case "PSYCH_UP":
		case "HEART_SWAP":
			// At +0 all stats: "no reduced stats and no target boosts" -> -10
			score = -10;
			break;

		case "RECOVERY":
		case "RECOVERY_WEATHER":
			if (context.attackerHPPercent >= 100) score = -8;
			break;

		case "SWALLOW":
			if (context.attackerHPPercent >= 100) score = -8;
			break;

		case "REFLECT":
		case "LIGHT_SCREEN":
		case "SAFEGUARD":
		case "MIST":
			// -8 if already active (assume not active)
			break;

		case "OHKO":
			if (mData) {
				var ohkoEff = aiGetEffectiveness(mData.type, defTypes);
				if (ohkoEff === 0) score = -10;
			}
			if (!isMoldBreaker && defAbility === "sturdy") score = -10;
			break;

		case "SUBSTITUTE":
			if (context.attackerHPPercent < 26) score = -10;
			break;

		case "LEECH_SEED":
			if (aiHasType(defender, "grass")) score = -10;
			else if (defAbility === "magic guard") score = -10;
			break;

		case "ROAR":
		case "ROAR_DAMAGE":
			if (context.defenderIsLast) score = -10;
			if (!isMoldBreaker && defAbility === "suction cups") score = -10;
			break;

		case "STEALTH_ROCK":
		case "SPIKES":
		case "TOXIC_SPIKES":
			if (context.defenderIsLast) score = -10;
			break;

		case "RAIN_DANCE":
			if (context.weather === "Rain") score = -8;
			break;
		case "SUNNY_DAY":
			if (context.weather === "Sun") score = -8;
			break;
		case "SANDSTORM":
			if (context.weather === "Sand") score = -8;
			break;
		case "HAIL":
			if (context.weather === "Hail") score = -8;
			break;

		case "BATON_PASS":
			if (context.attackerIsLast) score = -10;
			break;

		case "FAKE_OUT":
			if (!context.isFirstTurn) score = -10;
			break;

		case "HELPING_HAND":
			if (!context.isDoubles) score = -10;
			break;

		case "TRICK":
			if (!isMoldBreaker && defAbility === "sticky hold") score = -10;
			break;

		case "KNOCK_OFF":
			if (defAbility === "sticky hold") score = -10;
			break;

		case "TRICK_ROOM":
			if (context.attackerSpeed >= context.defenderSpeed) score = -10;
			break;

		case "SLEEP_TALK":
			score = -8; // not asleep on switch-in
			break;

		case "HEALING_WISH":
		case "LUNAR_DANCE":
			score = -20;
			if (context.attackerIsLast) score -= 10;
			break;

		case "FUTURE_SIGHT":
			score = -12;
			break;

		case "FOCUS_ENERGY":
		case "INGRAIN":
		case "MUD_SPORT":
		case "WATER_SPORT":
		case "CAMOUFLAGE":
		case "POWER_TRICK":
		case "LUCKY_CHANT":
		case "AQUA_RING":
		case "MAGNET_RISE":
			break; // -10 if already active; assume not active

		case "DISABLE":
		case "ENCORE":
			break; // -8 if already active

		case "MEAN_LOOK":
		case "PERISH_SONG":
		case "TORMENT":
		case "HEAL_BLOCK":
		case "TAUNT":
			break; // -10 if already active

		case "IMPRISON":
			break;

		case "GASTRO_ACID":
			if (defAbility === "multitype" || defAbility === "truant" || defAbility === "slow start" ||
				defAbility === "stench" || defAbility === "run away" || defAbility === "pickup" ||
				defAbility === "honey gather") score = -10;
			break;

		case "REFRESH":
			score = -10; // no status on switch-in
			break;

		case "CALM_MIND":
		case "BULK_UP":
		case "COSMIC_POWER":
			break;

		case "DRAGON_DANCE":
			if (context.trickRoom) score = -10;
			break;

		case "GRAVITY":
		case "TAILWIND":
			if (eff === "TAILWIND" && context.trickRoom) score = -10;
			break;

		case "NATURAL_GIFT":
			break;

		case "ACUPRESSURE":
			break;

		case "STOCKPILE":
			break;

		case "CHARGE_TURN":
		case "CHARGE_SOLAR":
		case "CHARGE_INVULN":
		case "SHADOW_FORCE":
			if (mData) {
				var ctEff = aiGetEffectiveness(mData.type, defTypes);
				if (ctEff === 0) score = -10;
				if (!isMoldBreaker && defAbility === "wonder guard" && ctEff <= 1) score = -10;
			}
			break;

		default:
			break;
	}

	return score;
}


/**
 * EVALUATE ATTACK FLAG
 * Philosophy: Prioritize raw damage output.
 */
function scoreEvaluateAttackFlag(moveName, mData, mEffect, attacker, defender, context) {
	var score = 0;
	var eff = mEffect ? mEffect.effect : null;

	// Skip non-standard damage moves
	if (moveName in AI_NONSTD_DAMAGE_MOVES) return 0;

	// Skip status moves
	if (!mData || mData.bp === 0) return 0;

	var myDamage = context.moveDamages ? (context.moveDamages[moveName] || 0) : 0;
	var defHP = context.defenderHP || 999;

	// 1. If max damage kills
	if (myDamage >= defHP) {
		if (eff === "SELF_DESTRUCT") {
			// no additional scoring
		} else if (eff === "FOCUS_PUNCH" || eff === "SUCKER_PUNCH" || eff === "FUTURE_SIGHT") {
			// 33.6% of +4 -> expected +1.34
			score += 1;
		} else if (eff === "PRIORITY_ATTACK" || (mData && mData.priority >= 1)) {
			score += 6;
		} else {
			score += 4;
		}
	}

	// 2. Not highest damage: -1
	if (context.highestDamage && myDamage < context.highestDamage) {
		score -= 1;
	}

	// 3. Self-Destruct/Focus Punch/Sucker Punch: 80% of -2
	if (eff === "SELF_DESTRUCT" || eff === "FOCUS_PUNCH" || eff === "SUCKER_PUNCH") {
		score -= 2;
	}

	// 4. Quad-effective: 31.25% of +2 -> expected +0.625
	if (mData) {
		var typeEff = aiGetEffectiveness(mData.type, aiGetTypes(defender));
		if (typeEff >= 4) {
			score += 1;
		}
	}

	return score;
}


/**
 * EXPERT FLAG
 * The most complex flag, covering ~100+ distinct move routines.
 */
function scoreExpertFlag(moveName, mData, mEffect, attacker, defender, context) {
	var score = 0;
	var eff = mEffect ? mEffect.effect : null;
	var atkHPPct = context.attackerHPPercent || 100;
	var defHPPct = context.defenderHPPercent || 100;
	var atkSpeed = context.attackerSpeed || 100;
	var defSpeed = context.defenderSpeed || 100;
	var isFaster = atkSpeed > defSpeed;
	var isSlower = atkSpeed < defSpeed;
	var defTypes = aiGetTypes(defender);
	var defAbility = (defender.ability || "").toLowerCase();
	var atkAbility = (attacker.ability || "").toLowerCase();

	switch (eff) {
		case "SLEEP":
		case "YAWN":
			// Attacker knows Dream Eater/Nightmare: 50% of +1
			if (context.attackerKnowsDreamEater || context.attackerKnowsNightmare) {
				score += 1;
			}
			break;

		case "POISON":
		case "TOXIC":
			// Attacker HP < 50% or defender HP <= 50%: -1
			if (atkHPPct < 50 || defHPPct <= 50) score -= 1;
			// Knows SpDef boost or Protect: 76.6% of +2
			if (context.attackerKnowsProtect || context.attackerKnowsDefBoost) score += 2;
			break;

		case "PARALYZE":
			// Slower: 92.2% of +3
			if (isSlower) score += 3;
			// HP <= 70%: -1
			if (atkHPPct <= 70) score -= 1;
			break;

		case "CONFUSE":
			if (defHPPct <= 70) score -= 1;
			if (defHPPct <= 50) score -= 1;
			if (defHPPct <= 30) score -= 1;
			break;

		case "SWAGGER":
			// Without Psych Up: 50% of +1
			if (context.attackerKnowsPsychUp) {
				// Target Attack at +0 (assumed): not >= -3 so skip -5
				if (context.isFirstTurn) score += 5;
				else score += 3;
			} else {
				score += 1;
			}
			break;

		case "FLATTER":
			if (defHPPct <= 70) score -= 1;
			if (defHPPct <= 50) score -= 1;
			if (defHPPct <= 30) score -= 1;
			// 50% of +1
			score += 1;
			break;

		case "DRAIN":
			// Target resists/immune: 80.5% of -3
			if (mData) {
				var drainEff = aiGetEffectiveness(mData.type, defTypes);
				if (drainEff < 1) score -= 2;
			}
			break;

		case "DREAM_EATER":
			if (mData) {
				var deEff = aiGetEffectiveness(mData.type, defTypes);
				if (deEff < 1) score -= 1;
				// Target asleep: 80.1% of +3 -- target not asleep on switch-in
			}
			break;

		case "SELF_DESTRUCT":
		case "MEMENTO":
			// HP thresholds
			if (atkHPPct >= 80) {
				if (isFaster) score -= 2; // 80.5% of -3
				else score -= 1; // 80.5% of -1
			} else if (atkHPPct > 50) {
				score -= 1; // 80.5% of -1
			} else if (atkHPPct > 30) {
				score += 1; // 50% of +1
			} else {
				score += 1; // 80.5% of +1
			}
			break;

		case "HEALING_WISH":
		case "LUNAR_DANCE":
			if (atkHPPct >= 80 && isFaster) score -= 1;
			else if (atkHPPct > 50) score -= 1;
			score += 1; // ~75% of +1 party check
			if (atkHPPct <= 30) score += 1;
			break;

		case "MIRROR_MOVE":
			// Can't track last move. 68.75% of -1
			score -= 1;
			break;

		case "STAT_BOOST_ATK":
			// At +0: no +3 penalty
			// Full HP: 50% of +2
			if (atkHPPct >= 100) score += 1;
			// HP < 40%: -2
			if (atkHPPct < 40) score -= 2;
			// HP 40-69%: 84.4% of -2
			else if (atkHPPct < 70) score -= 2;
			break;

		case "STAT_BOOST_DEF":
			if (atkHPPct >= 100) score += 1;
			else if (atkHPPct >= 70) score += 0; // 78.1% suppress
			else if (atkHPPct < 40) score -= 2;
			else score -= 2;
			break;

		case "STAT_BOOST_SPE":
			// Speed boost (Agility, Rock Polish, NOT Dragon Dance)
			if (isFaster) score -= 3;
			if (isSlower) score += 2; // 72.7% of +3
			break;

		case "STAT_BOOST_EVA":
			// HP >= 90%: 60.9% of +3
			if (atkHPPct >= 90) score += 2;
			break;

		case "DRAGON_DANCE":
			if (isSlower) score += 1; // 50% of +1
			if (atkHPPct <= 50) score -= 1; // 72.7% of -1
			break;

		case "CALM_MIND":
		case "BULK_UP":
		case "COSMIC_POWER":
			if (atkHPPct >= 100) score += 1;
			else if (atkHPPct < 40) score -= 2;
			else if (atkHPPct < 70) score -= 2;
			break;

		case "ACUPRESSURE":
			if (atkHPPct <= 50) score -= 1;
			else if (atkHPPct > 90) score += 1;
			break;

		case "STAT_DROP_ATK":
			if (defHPPct <= 70) score -= 2;
			break;

		case "STAT_DROP_DEF":
			if (atkHPPct < 70) score -= 2;
			if (defHPPct < 70) score -= 2;
			break;

		case "STAT_DROP_SPE":
			if (isSlower) score += 1; // 72.7% of +2
			if (isFaster) score -= 3;
			break;

		case "STAT_DROP_ACC":
			if (atkHPPct < 70) score -= 2;
			break;

		case "STAT_DROP_EVA":
		case "STAT_DROP_SPD":
			if (atkHPPct < 70) score -= 2;
			if (defHPPct <= 70) score -= 2;
			break;

		case "ACCURACY_IGNORE":
			// No evasion boosts assumed
			break;

		case "VITAL_THROW":
			break;

		case "HAZE":
			// At +0 all stats: -1
			score -= 1;
			break;

		case "BIDE":
			if (atkHPPct <= 90) score -= 2;
			break;

		case "ROAR":
			// No boosts assumed: -3
			score -= 3;
			break;

		case "CONVERSION":
			if (atkHPPct <= 90) score -= 2;
			if (!context.isFirstTurn) score -= 2;
			break;

		case "RECOVERY":
			if (atkHPPct >= 100) { score -= 3; break; }
			if (isFaster) { score -= 8; break; }
			if (atkHPPct >= 70) { score -= 3; break; }
			score += 2; // 92.2% of +2
			break;

		case "RECOVERY_WEATHER":
			if (atkHPPct >= 100) { score -= 3; break; }
			if (isFaster) { score -= 8; break; }
			if (atkHPPct >= 70) { score -= 3; break; }
			score += 2;
			if (context.weather === "Sand" || context.weather === "Hail" || context.weather === "Rain") {
				score -= 2;
			}
			break;

		case "REST":
			if (isFaster) {
				if (atkHPPct >= 100) { score -= 5; break; }
				if (atkHPPct > 50) { score -= 3; break; }
				if (atkHPPct >= 40) { score -= 2; break; }
			} else {
				if (atkHPPct > 70) { score -= 3; break; }
				if (atkHPPct >= 60) { score -= 2; break; }
			}
			score += 3; // 96.1% of +3
			break;

		case "REFLECT":
			if (atkHPPct < 50) score -= 2;
			if (atkHPPct >= 90) score += 1;
			break;

		case "LIGHT_SCREEN":
			if (atkHPPct < 50) score -= 2;
			if (atkHPPct >= 90) score += 1;
			break;

		case "LEECH_SEED":
			if (aiHasDamagingMove(context.moveNames) && atkHPPct <= 50) score -= 2;
			if (aiHasDamagingMove(context.moveNames) && defHPPct <= 50) score -= 2;
			if (context.attackerKnowsProtect) score += 2;
			break;

		case "PROTECT":
			if (context.isDoubles) score += 2;
			else score += 1; // 33.2% of +2
			break;

		case "OHKO":
			// 25% of +1
			break;

		case "CHARGE_TURN":
			if (context.defenderKnowsProtect) score -= 2;
			if (atkHPPct <= 38) score -= 1;
			break;

		case "CHARGE_SOLAR":
			if (context.weather === "Sun") score += 2;
			else {
				if (context.defenderKnowsProtect) score -= 2;
				if (atkHPPct <= 38) score -= 1;
			}
			break;

		case "CHARGE_INVULN":
			if (context.defenderKnowsProtect) score -= 1;
			if (context.weather === "Sand" && (aiHasType(attacker, "rock") || aiHasType(attacker, "ground") || aiHasType(attacker, "steel"))) score += 1;
			if (context.weather === "Hail" && aiHasType(attacker, "ice")) score += 1;
			if (isFaster) score += 1;
			break;

		case "SHADOW_FORCE":
			if (isFaster) score += 1;
			break;

		case "FAKE_OUT":
			score += 2;
			break;

		case "SPIT_UP":
			// Assume 0 stockpile
			break;

		case "SUPER_FANG":
			if (defHPPct <= 50) score -= 1;
			break;

		case "BINDING":
		case "WHIRLPOOL":
			break;

		case "HIGH_CRIT":
			if (mData) {
				var critEff = aiGetEffectiveness(mData.type, defTypes);
				if (critEff >= 2) score += 1;
			}
			break;

		case "RECOIL":
		case "RECOIL_HIGH":
			if (mData) {
				var recoilEff = aiGetEffectiveness(mData.type, defTypes);
				if (recoilEff >= 1) {
					if (atkAbility === "rock head" || atkAbility === "magic guard") score += 1;
				}
			}
			break;

		case "SPEED_DROP_ATTACK":
			if (isSlower) score += 2;
			if (isFaster) score -= 3;
			break;

		case "RECHARGE":
			if (mData) {
				var rechEff = aiGetEffectiveness(mData.type, defTypes);
				if (rechEff < 1) score -= 1;
			}
			if (atkAbility === "truant") score += 1;
			if (isSlower && atkHPPct >= 60) score -= 1;
			if (isFaster && atkHPPct > 40) score -= 1;
			break;

		case "DISABLE":
			if (isSlower) break;
			break;

		case "ENCORE":
			if (isSlower) score -= 2;
			else score += 1; // simplified
			break;

		case "COUNTER":
		case "MIRROR_COAT":
			if (atkHPPct <= 30) score -= 1;
			if (atkHPPct <= 50) score -= 1;
			if (context.attackerKnowsCounterAndMirrorCoat) score += 2;
			break;

		case "METAL_BURST":
			if (atkHPPct <= 30) score -= 1;
			if (atkHPPct <= 50) score -= 1;
			if (atkHPPct > 50) score += 1;
			break;

		case "PAIN_SPLIT":
			if (defHPPct < 80) score -= 1;
			if (isSlower) {
				if (atkHPPct > 60) score -= 1;
				else score += 1;
			}
			if (atkHPPct > 40) score -= 1;
			break;

		case "NIGHTMARE":
			score += 2;
			break;

		case "LOCK_ON":
			score += 1; // 50% of +2
			break;

		case "SLEEP_TALK":
			if (!context.attackerIsAsleep) score -= 5;
			else score += 10;
			break;

		case "DESTINY_BOND":
			score -= 1;
			if (isFaster) break;
			if (atkHPPct <= 30) score += 2;
			else if (atkHPPct <= 50) score += 1;
			break;

		case "FLAIL":
			if (isSlower) {
				if (atkHPPct > 60) score -= 1;
				else if (atkHPPct <= 40) score += 1;
			} else {
				if (atkHPPct > 33) score -= 1;
				else if (atkHPPct <= 20) score += 1;
			}
			break;

		case "AROMATHERAPY":
			// No team status assumed: -5
			score -= 5;
			break;

		case "THIEF":
			score -= 2;
			break;

		case "CURSE":
			if (aiHasType(attacker, "ghost")) {
				if (atkHPPct <= 80) score -= 1;
			} else {
				if (context.attackerKnowsGyro || context.attackerKnowsTrickRoom) score += 1;
				score += 1; // 50% of +1
				score += 1; // Defense <= +1 bonuses at +0
			}
			break;

		case "FORESIGHT":
			// BUG: checks attacker Ghost typing
			if (aiHasType(attacker, "ghost")) score += 1;
			else score -= 2;
			break;

		case "MIRACLE_EYE":
			if (aiHasType(defender, "dark")) score += 1;
			else score -= 2;
			break;

		case "ENDURE":
			if (atkHPPct < 4) score -= 1;
			if (atkHPPct < 35) score += 1;
			break;

		case "SUBSTITUTE":
			if (context.attackerKnowsFocusPunch) score += 1;
			if (atkHPPct <= 90 && atkHPPct > 70) score -= 1;
			else if (atkHPPct <= 70 && atkHPPct > 50) score -= 1;
			else if (atkHPPct <= 50) score -= 2;
			break;

		case "BATON_PASS":
			// At +0 stats: -2
			score -= 2;
			break;

		case "PURSUIT":
			if (context.isFirstTurn) score += 1;
			if (aiHasType(defender, "ghost") || aiHasType(defender, "psychic")) score += 1;
			if (context.defenderKnowsUturn) score += 1;
			break;

		case "RAIN_DANCE":
			if (atkAbility === "swift swim" && isSlower) { score += 1; break; }
			if (atkHPPct < 40) score -= 1;
			if (context.weather && context.weather !== "Rain") score += 1;
			if (atkAbility === "rain dish") score += 1;
			break;

		case "SUNNY_DAY":
			if (atkHPPct < 40) score -= 1;
			if (context.weather && context.weather !== "Sun") score += 1;
			if (atkAbility === "flower gift" || atkAbility === "solar power") score += 1;
			break;

		case "HAIL":
			if (atkHPPct < 40) { score -= 1; break; }
			if (context.weather && context.weather !== "Hail") {
				score += 1;
				if (context.attackerKnowsBlizzard) score += 2;
			}
			if (atkAbility === "ice body") score += 2;
			break;

		case "SANDSTORM":
			if (atkHPPct < 40) score -= 1;
			if (context.weather && context.weather !== "Sand") score += 1;
			break;

		case "TRICK_ROOM":
			if (isFaster) score -= 1;
			if (isSlower) score += 2; // 75% of +3
			break;

		case "GRAVITY":
			if (defAbility === "levitate" || aiHasType(defender, "flying")) score += 1;
			break;

		case "TAILWIND":
			if (isFaster) score -= 1;
			if (atkHPPct <= 30) score -= 1;
			if (atkHPPct > 75) score += 1;
			break;

		case "BELLY_DRUM":
			if (atkHPPct < 90) score -= 2;
			break;

		case "PSYCH_UP":
			// At +0 (assumed): -2
			score -= 2;
			break;

		case "FACADE":
			// BUG: checks target status. No status on switch-in
			break;

		case "FOCUS_PUNCH":
			if (mData) {
				var fpEff = aiGetEffectiveness("fighting", defTypes);
				if (fpEff < 1) score -= 1;
			}
			break;

		case "SUPERPOWER":
			if (mData) {
				var spEff = aiGetEffectiveness("fighting", defTypes);
				if (spEff < 1) score -= 1;
			}
			if (isSlower && atkHPPct >= 60) score -= 1;
			if (isFaster && atkHPPct > 40) score -= 1;
			break;

		case "CLOSE_COMBAT":
			if (mData) {
				var ccEff = aiGetEffectiveness("fighting", defTypes);
				if (ccEff < 1) score -= 1;
			}
			if (isSlower && atkHPPct <= 80) score -= 1;
			if (isFaster && atkHPPct <= 60) score -= 1;
			break;

		case "HAMMER_ARM":
			if (mData) {
				var haEff = aiGetEffectiveness("fighting", defTypes);
				if (haEff < 1) score -= 1;
			}
			if (isSlower) score += 1;
			break;

		case "REDUCE_SPATK":
			if (mData) {
				var ohEff = aiGetEffectiveness(mData.type, defTypes);
				if (ohEff < 1) score -= 1;
			}
			if (isFaster && atkHPPct <= 60) score -= 1;
			if (isSlower && atkHPPct <= 80) score -= 1;
			break;

		case "WATER_SPOUT":
			if (mData) {
				var wsEff = aiGetEffectiveness(mData.type, defTypes);
				if (wsEff < 1) score -= 1;
			}
			// BUG: checks opponent HP
			if (isSlower && defHPPct <= 70) score -= 1;
			if (isFaster && defHPPct <= 50) score -= 1;
			break;

		case "U_TURN":
			if (mData) {
				var utEff = aiGetEffectiveness(mData.type, defTypes);
				if (utEff < 1) { score -= 1; break; }
			}
			if (context.attackerIsLast) { score += 2; break; }
			if (context.attackerHasSEMove) score -= 2;
			if (defHPPct > 70) score += 1;
			if (isFaster) score += 1;
			break;

		case "BRICK_BREAK":
			// Can't track screens
			break;

		case "KNOCK_OFF":
			break;

		case "ENDEAVOR":
			if (defHPPct < 70) { score -= 1; break; }
			if (isSlower) {
				score += (atkHPPct > 50) ? -1 : 1;
			} else {
				score += (atkHPPct > 40) ? -1 : 1;
			}
			break;

		case "IMPRISON":
			if (!context.isFirstTurn) score += 1;
			break;

		case "SPIKES":
			score += 1;
			if (context.attackerKnowsRoar) score += 1;
			break;

		case "STEALTH_ROCK":
			score += 1;
			if (context.attackerKnowsRoar) score += 1;
			break;

		case "TOXIC_SPIKES":
			score += 1;
			if (context.attackerKnowsRoar) score += 1;
			break;

		case "MUD_SPORT":
		case "WATER_SPORT":
			if (atkHPPct < 50) score -= 1;
			if (eff === "MUD_SPORT" && aiHasType(defender, "electric")) score += 1;
			if (eff === "WATER_SPORT" && aiHasType(defender, "fire")) score += 1;
			break;

		case "BLIZZARD":
			if (mData) {
				var blizEff = aiGetEffectiveness("ice", defTypes);
				if (blizEff < 1) score -= 2;
			}
			if (context.weather === "Hail") score += 1;
			break;

		case "CAPTIVATE":
			if (defHPPct <= 70) score -= 2;
			break;

		case "BRINE":
			if (mData) {
				var brEff = aiGetEffectiveness("water", defTypes);
				if (brEff < 1) score -= 1;
			}
			if (defHPPct <= 50) score += 1;
			break;

		case "PAYBACK":
			if (mData) {
				var payEff = aiGetEffectiveness(mData.type, defTypes);
				if (payEff < 1) score -= 1;
			}
			if (isSlower && atkHPPct >= 30) score += 1;
			break;

		case "PLUCK":
			if (mData) {
				var plkEff = aiGetEffectiveness(mData.type, defTypes);
				if (plkEff < 1) score -= 1;
			}
			if (context.isFirstTurn) score += 1;
			break;

		case "SUCKER_PUNCH":
			if (mData) {
				var skEff = aiGetEffectiveness(mData.type, defTypes);
				if (skEff < 1) score -= 1;
			}
			score += 1; // 75% of +1
			break;

		case "WRING_OUT":
			if (mData) {
				var woEff = aiGetEffectiveness(mData.type, defTypes);
				if (woEff < 1) score -= 1;
			}
			if (defHPPct < 50) score -= 1;
			if (defHPPct >= 100) {
				score += 1;
				if (isFaster) score += 2;
				else score += 1;
			} else if (defHPPct > 85) {
				score += 1;
			}
			break;

		case "PUNISHMENT":
			// At +0: no bonus
			break;

		case "EMBARGO":
			break;

		case "WORRY_SEED":
			if (context.defenderKnowsRest) score += 1;
			score += 1; // 75% of +1
			break;

		case "HEAL_BLOCK":
			if (context.defenderKnowsRecovery) score += 1;
			break;

		case "MAGIC_COAT":
			if (context.isFirstTurn) score += 0;
			else score -= 1;
			break;

		case "RECYCLE":
			score -= 2;
			break;

		case "AVALANCHE":
			score -= 1; // expected: 0.703*(-2) + 0.297*(+2)
			break;

		case "SNATCH":
			if (context.isFirstTurn) score += 1;
			break;

		case "POWER_TRICK":
			if (atkHPPct > 90) score += 1;
			break;

		case "GASTRO_ACID":
			if (defHPPct > 70) score += 1;
			else if (defHPPct <= 50) score -= 1;
			break;

		case "LUCKY_CHANT":
			if (atkHPPct < 70) score -= 1;
			break;

		case "ME_FIRST":
			if (isSlower) score -= 2;
			break;

		case "COPYCAT":
			if (isSlower) score -= 1;
			break;

		case "SKILL_SWAP":
			var desirable = ["speed boost", "battle armor", "sand veil", "static", "flash fire",
				"wonder guard", "effect spore", "swift swim", "huge power", "rain dish",
				"cute charm", "shed skin", "marvel scale", "pure power", "chlorophyll",
				"shield dust", "adaptability", "magic guard", "mold breaker", "super luck",
				"unaware", "tinted lens", "filter", "solid rock", "reckless"];
			if (desirable.indexOf(atkAbility) !== -1) score -= 1;
			if (desirable.indexOf(defAbility) !== -1) score += 2;
			break;

		case "FEINT":
			break;

		case "PRESENT":
			break;

		case "DEFOG":
			score -= 2;
			break;

		case "PSYCHO_SHIFT":
			break;

		case "SMELLING_SALT":
			break;

		case "WAKE_UP_SLAP":
			if (mData) {
				var wuEff = aiGetEffectiveness("fighting", defTypes);
				if (wuEff < 1) score -= 1;
			}
			break;

		case "ASSURANCE":
			if (mData) {
				var asEff = aiGetEffectiveness(mData.type, defTypes);
				if (asEff < 1) score -= 1;
			}
			break;

		case "TRUMP_CARD":
			break;

		case "GYRO_BALL":
			break;

		default:
			break;
	}

	return score;
}


/**
 * SETUP FIRST TURN FLAG
 * On the first turn: 68.75% chance of +2 for setup moves.
 * Expected: +1.375 -> rounded to +1
 */
function scoreSetupFlag(moveName, mData, mEffect, attacker, defender, context) {
	if (!context.isFirstTurn) return 0;
	var eff = mEffect ? mEffect.effect : null;

	var setupEffects = [
		"STAT_BOOST_ATK", "STAT_BOOST_DEF", "STAT_BOOST_SPE", "STAT_BOOST_EVA",
		"STAT_DROP_ATK", "STAT_DROP_DEF", "STAT_DROP_SPE", "STAT_DROP_ACC", "STAT_DROP_EVA", "STAT_DROP_SPD",
		"DRAGON_DANCE", "CALM_MIND", "BULK_UP", "COSMIC_POWER", "BELLY_DRUM",
		"ACUPRESSURE", "CONVERSION",
		"REFLECT", "LIGHT_SCREEN",
		"SLEEP", "YAWN", "POISON", "TOXIC", "PARALYZE", "BURN",
		"CONFUSE", "SWAGGER", "FLATTER", "ATTRACT",
		"LEECH_SEED", "SUBSTITUTE",
		"TAILWIND", "MAGNET_RISE", "INGRAIN",
		"TORMENT", "IMPRISON", "LUCKY_CHANT",
		"CAMOUFLAGE", "DEFOG", "WHIRLPOOL",
		"TICKLE", "CAPTIVATE", "MEMENTO"
	];

	if (setupEffects.indexOf(eff) !== -1) {
		return 1;
	}
	return 0;
}


/**
 * RISKY FLAG
 * 50% chance of +2 for risky moves. Expected: +1.
 */
function scoreRiskyFlag(moveName, mData, mEffect, attacker, defender, context) {
	var eff = mEffect ? mEffect.effect : null;

	var riskyEffects = [
		"SLEEP", "YAWN",
		"SELF_DESTRUCT",
		"MIRROR_MOVE",
		"OHKO",
		"HIGH_CRIT",
		"CONFUSE", "SWAGGER", "FLATTER",
		"METRONOME",
		"PSYWAVE",
		"COUNTER", "MIRROR_COAT", "METAL_BURST",
		"DESTINY_BOND",
		"ATTRACT",
		"PRESENT",
		"OMNI_BOOST",
		"BELLY_DRUM",
		"FOCUS_PUNCH",
		"GYRO_BALL",
		"ACUPRESSURE",
		"PAYBACK",
		"ME_FIRST",
		"SUCKER_PUNCH"
	];

	if (riskyEffects.indexOf(eff) !== -1) {
		return 1;
	}
	return 0;
}


/**
 * PRIORITIZE EXTREMES (DamagePriority) FLAG
 * ~61% of +2 for non-standard damage moves. Expected: +1.22 -> +1
 */
function scoreDamagePriorityFlag(moveName, mData, mEffect, attacker, defender, context) {
	if (moveName in AI_NONSTD_DAMAGE_MOVES) {
		return 1;
	}
	return 0;
}


/**
 * BATON PASS FLAG
 * Encourages setup then passing. Only for non-damaging moves.
 */
function scoreBatonPassFlag(moveName, mData, mEffect, attacker, defender, context) {
	if (mData && mData.bp > 0) return 0; // exits for damaging moves
	if (context.attackerIsLast) return 0;

	var eff = mEffect ? mEffect.effect : null;
	var atkHPPct = context.attackerHPPercent || 100;

	// Step 1: Setup moves
	var setupMoves = ["STAT_BOOST_ATK", "STAT_BOOST_DEF", "STAT_BOOST_SPE",
		"DRAGON_DANCE", "CALM_MIND", "BULK_UP"];
	if (setupMoves.indexOf(eff) !== -1) {
		if (context.isFirstTurn) return 5;
		if (atkHPPct >= 60) return 1;
		return -10;
	}

	// Step 2: Protect/Detect
	if (eff === "PROTECT") {
		// Previous move Protect: -2, else +2. Assume no previous use.
		return 2;
	}

	// Step 3: Baton Pass
	if (eff === "BATON_PASS") {
		if (context.isFirstTurn) return -2;
		// Attack/SpAttack at +0: no bonus
		return 0;
	}

	// Step 4: All other non-damaging moves: ~92% of +3
	return 3;
}


/**
 * TAG STRATEGY FLAG
 * Doubles-only. Complex partner synergy logic.
 */
function scoreTagStrategyFlag(moveName, mData, mEffect, attacker, defender, context) {
	if (!context.isDoubles) return 0;

	var eff = mEffect ? mEffect.effect : null;
	var atkAbility = (attacker.ability || "").toLowerCase();

	// Spread moves
	if (moveName === "Earthquake" || moveName === "Magnitude") {
		return -2;
	}
	if (moveName === "Surf") {
		return -2;
	}
	if (moveName === "Discharge") {
		return -2;
	}
	if (moveName === "Lava Plume") {
		return -2;
	}

	if (eff === "HELPING_HAND") {
		return 2;
	}

	if (eff === "FOLLOW_ME") {
		return 1;
	}

	// Effectiveness in doubles
	if (mData && mData.bp > 0) {
		var typeEff = aiGetEffectiveness(mData.type, aiGetTypes(defender));
		if (typeEff >= 4) return 1;
		if (typeEff >= 2) return 1;
		if (typeEff < 2) return -1;
	}

	// Weather team synergy
	if (eff === "RAIN_DANCE") {
		if (atkAbility === "hydration" || atkAbility === "dry skin") return 2;
		return 0;
	}
	if (eff === "SUNNY_DAY") {
		if (atkAbility === "flower gift") return 2;
		if (atkAbility === "dry skin") return -2;
		return 0;
	}
	if (eff === "HAIL") {
		if (atkAbility === "ice body" || atkAbility === "snow cloak") return 2;
		return 0;
	}
	if (eff === "SANDSTORM") {
		if (atkAbility === "sand veil") return 2;
		if (aiHasType(attacker, "rock")) return 2;
		return 0;
	}

	if (eff === "GRAVITY") {
		if ((defender.ability || "").toLowerCase() === "levitate" || aiHasType(defender, "flying")) return 2;
		return 0;
	}

	if (eff === "TRICK_ROOM") {
		return 0;
	}

	return 0;
}


/**
 * CHECK HP FLAG
 * Phase 1: Attacker's HP thresholds.
 * Phase 2: Target's HP thresholds (only if target HP < 71%).
 * All checks: 80.5% of -2 -> expected -1.61 -> rounded to -2
 */
function scoreCheckHPFlag(moveName, mData, mEffect, attacker, defender, context) {
	var score = 0;
	var eff = mEffect ? mEffect.effect : null;
	var atkHPPct = context.attackerHPPercent || 100;
	var defHPPct = context.defenderHPPercent || 100;

	// Phase 1: Attacker's HP

	// Self-Destruct: HP >= 31% -> 80.5% of -2
	if (eff === "SELF_DESTRUCT" && atkHPPct >= 31) score -= 2;

	// Recovery/Rest/Destiny Bond/Flail/Reversal/Memento/Healing Wish/Lunar Dance/Grudge:
	// HP >= 71% -> 80.5% of -2
	var recoveryLike = ["RECOVERY", "RECOVERY_WEATHER", "REST", "DESTINY_BOND", "FLAIL",
		"MEMENTO", "HEALING_WISH", "LUNAR_DANCE"];
	if (recoveryLike.indexOf(eff) !== -1 && atkHPPct >= 71) score -= 2;

	// Stat boost/reduce/Focus Energy/Bide/Conversion/Screens/Belly Drum:
	// HP < 70% -> 80.5% of -2
	var boostLike = ["STAT_BOOST_ATK", "STAT_BOOST_DEF", "STAT_BOOST_SPE", "STAT_BOOST_EVA",
		"STAT_DROP_ATK", "STAT_DROP_DEF", "STAT_DROP_SPE", "STAT_DROP_ACC", "STAT_DROP_EVA", "STAT_DROP_SPD",
		"DRAGON_DANCE", "CALM_MIND", "BULK_UP", "COSMIC_POWER",
		"FOCUS_ENERGY", "BIDE", "CONVERSION",
		"REFLECT", "LIGHT_SCREEN", "MIST", "SAFEGUARD",
		"BELLY_DRUM", "TICKLE", "CAPTIVATE"];
	if (boostLike.indexOf(eff) !== -1 && atkHPPct < 70) score -= 2;

	// Lucky Chant/Power Swap/Guard Swap: HP 31-70% -> 80.5% of -2
	if ((eff === "LUCKY_CHANT" || eff === "POWER_SWAP" || eff === "GUARD_SWAP") &&
		atkHPPct >= 31 && atkHPPct <= 70) score -= 2;

	// Rage/Lock On/Psych Up/Mirror Coat/Metal Burst/Water Spout/Eruption/Mud Sport/Water Sport/Acupressure:
	// HP <= 30% -> 80.5% of -2
	var lowHPPenalty = ["LOCK_ON", "PSYCH_UP", "MIRROR_COAT", "METAL_BURST",
		"WATER_SPOUT", "MUD_SPORT", "WATER_SPORT", "ACUPRESSURE"];
	if (lowHPPenalty.indexOf(eff) !== -1 && atkHPPct <= 30) score -= 2;

	// Phase 2: Target's HP (exit if target HP >= 71%)
	if (defHPPct >= 71) return score;

	// Stat moves/Poison Gas/Mist/Pain Split/Safeguard/Acupressure/Wring Out/Perish Song:
	// 80.5% of -2
	var targetLowPenalty1 = ["STAT_BOOST_ATK", "STAT_BOOST_DEF", "STAT_BOOST_SPE", "STAT_BOOST_EVA",
		"STAT_DROP_ATK", "STAT_DROP_DEF", "STAT_DROP_SPE", "STAT_DROP_ACC", "STAT_DROP_EVA", "STAT_DROP_SPD",
		"POISON", "MIST", "PAIN_SPLIT", "SAFEGUARD", "ACUPRESSURE", "WRING_OUT", "PERISH_SONG",
		"TICKLE", "CAPTIVATE", "MEMENTO"];
	if (targetLowPenalty1.indexOf(eff) !== -1) score -= 2;

	// At target HP <= 30%: additional -2
	if (defHPPct <= 30) {
		var targetVeryLow = ["POISON", "TOXIC", "PARALYZE", "BURN", "SLEEP", "YAWN",
			"CONFUSE", "SWAGGER", "FLATTER",
			"BIDE", "CONVERSION", "TOXIC_SPIKES", "LIGHT_SCREEN",
			"OHKO", "SUPER_FANG", "LOCK_ON",
			"SELF_DESTRUCT"];
		if (targetVeryLow.indexOf(eff) !== -1) score -= 2;
	}

	return score;
}


/**
 * WEATHER FLAG
 * First turn only: +5 for weather moves if not already active.
 */
function scoreWeatherFlag(moveName, mData, mEffect, attacker, defender, context) {
	if (!context.isFirstTurn) return 0;

	var eff = mEffect ? mEffect.effect : null;
	var weatherEffects = {
		"RAIN_DANCE": "Rain",
		"SUNNY_DAY": "Sun",
		"SANDSTORM": "Sand",
		"HAIL": "Hail"
	};

	if (eff in weatherEffects) {
		if (context.weather !== weatherEffects[eff]) return 5;
	}

	return 0;
}


/**
 * HARASSMENT FLAG
 * 50% of +2 for harassing/disruptive moves. Expected: +1.
 */
function scoreHarassmentFlag(moveName, mData, mEffect, attacker, defender, context) {
	var eff = mEffect ? mEffect.effect : null;

	var harassEffects = [
		"SLEEP", "YAWN", "POISON", "TOXIC", "PARALYZE", "BURN",
		"CONFUSE", "SWAGGER", "FLATTER", "ATTRACT",
		"STAT_DROP_ATK", "STAT_DROP_DEF", "STAT_DROP_SPE",
		"STAT_DROP_ACC", "STAT_DROP_EVA", "STAT_DROP_SPD",
		"LEECH_SEED", "ENCORE", "SPITE",
		"SPIKES", "TOXIC_SPIKES",
		"TORMENT", "KNOCK_OFF", "IMPRISON",
		"SECRET_POWER", "NATURE_POWER",
		"TICKLE", "CAMOUFLAGE", "EMBARGO",
		"PSYCHO_SHIFT", "CAPTIVATE", "DEFOG"
	];

	if (harassEffects.indexOf(eff) !== -1) {
		return 1;
	}
	return 0;
}


// ============================================================================
// MAIN SCORING ENGINE
// ============================================================================

function scoreAIMoves(attacker, defender, moveNames, trainerFlags, fieldObj, extraContext) {
	if (!attacker || !defender || !moveNames || !trainerFlags) return [];

	extraContext = extraContext || {};

	var atkSpeed = attacker.stats ? (attacker.stats.spe || 100) : 100;
	var defSpeed = defender.stats ? (defender.stats.spe || 100) : 100;

	// Pre-calculate damage for all moves
	var moveDamages = {};
	var highestDamage = 0;
	for (var i = 0; i < moveNames.length; i++) {
		var mn = moveNames[i];
		if (!mn || mn === "(No Move)") continue;
		if (mn in AI_NONSTD_DAMAGE_MOVES) {
			moveDamages[mn] = 0;
			continue;
		}
		var dmg = aiCalcMaxDamage(attacker, defender, mn, fieldObj);
		moveDamages[mn] = dmg;
		if (dmg > highestDamage) highestDamage = dmg;
	}

	// Pre-check attacker move knowledge
	var knowsDreamEater = aiKnowsMove(moveNames, "Dream Eater");
	var knowsNightmare = aiKnowsMove(moveNames, "Nightmare");
	var knowsRoar = aiKnowsAnyMove(moveNames, ["Roar", "Whirlwind"]);
	var knowsFocusPunch = aiKnowsMove(moveNames, "Focus Punch");
	var knowsProtect = aiKnowsAnyMove(moveNames, ["Protect", "Detect"]);
	var knowsBlizzard = aiKnowsMove(moveNames, "Blizzard");
	var knowsGyro = aiKnowsMove(moveNames, "Gyro Ball");
	var knowsTrickRoom = aiKnowsMove(moveNames, "Trick Room");
	var knowsPsychUp = aiKnowsMove(moveNames, "Psych Up");
	var knowsDefBoost = aiKnowsAnyMove(moveNames, ["Amnesia", "Iron Defense", "Acid Armor", "Barrier",
		"Calm Mind", "Cosmic Power"]);
	var knowsCounter = aiKnowsMove(moveNames, "Counter");
	var knowsMirrorCoat = aiKnowsMove(moveNames, "Mirror Coat");
	var hasSEMove = false;
	for (var i = 0; i < moveNames.length; i++) {
		if (aiIsSuperEffective(moveNames[i], defender)) { hasSEMove = true; break; }
	}

	// Defender move knowledge
	var defMoves = [];
	if (defender.moves) {
		for (var i = 0; i < defender.moves.length; i++) {
			var dm = defender.moves[i];
			if (typeof dm === "string") defMoves.push(dm);
			else if (dm && dm.name) defMoves.push(dm.name);
			else if (dm && dm.originalName) defMoves.push(dm.originalName);
		}
	}
	var defKnowsProtect = aiKnowsAnyMove(defMoves, ["Protect", "Detect"]);
	var defKnowsUturn = aiKnowsAnyMove(defMoves, ["U-turn", "Volt Switch"]);
	var defKnowsRest = aiKnowsMove(defMoves, "Rest");
	var defKnowsRecovery = aiKnowsAnyMove(defMoves, ["Recover", "Milk Drink", "Softboiled", "Slack Off",
		"Roost", "Wish", "Synthesis", "Morning Sun", "Moonlight", "Rest"]);

	// HP info
	var defMaxHP = (typeof defender.maxHP === "function" ? defender.maxHP() : defender.rawStats && defender.rawStats.hp) || 300;
	var defCurHP = (typeof defender.curHP === "function" ? defender.curHP() : defender.originalCurHP) || defMaxHP;
	var atkMaxHP = (typeof attacker.maxHP === "function" ? attacker.maxHP() : attacker.rawStats && attacker.rawStats.hp) || 300;
	var atkCurHP = (typeof attacker.curHP === "function" ? attacker.curHP() : attacker.originalCurHP) || atkMaxHP;

	var context = {
		attackerHPPercent: extraContext.attackerHPPercent || Math.round((atkCurHP / atkMaxHP) * 100),
		defenderHPPercent: extraContext.defenderHPPercent || Math.round((defCurHP / defMaxHP) * 100),
		defenderHP: defCurHP,
		attackerSpeed: atkSpeed,
		defenderSpeed: defSpeed,
		moveDamages: moveDamages,
		highestDamage: highestDamage,
		moveNames: moveNames,
		isFirstTurn: extraContext.isFirstTurn !== undefined ? extraContext.isFirstTurn : true,
		isDoubles: extraContext.isDoubles || false,
		attackerIsLast: extraContext.attackerIsLast || false,
		defenderIsLast: extraContext.defenderIsLast || false,
		attackerIsAsleep: extraContext.attackerIsAsleep || false,
		weather: extraContext.weather || null,
		trickRoom: extraContext.trickRoom || false,
		attackerKnowsDreamEater: knowsDreamEater,
		attackerKnowsNightmare: knowsNightmare,
		attackerKnowsRoar: knowsRoar,
		attackerKnowsFocusPunch: knowsFocusPunch,
		attackerKnowsProtect: knowsProtect,
		attackerKnowsBlizzard: knowsBlizzard,
		attackerKnowsGyro: knowsGyro,
		attackerKnowsTrickRoom: knowsTrickRoom,
		attackerKnowsPsychUp: knowsPsychUp,
		attackerKnowsDefBoost: knowsDefBoost,
		attackerKnowsCounterAndMirrorCoat: knowsCounter && knowsMirrorCoat,
		attackerHasSEMove: hasSEMove,
		defenderKnowsProtect: defKnowsProtect,
		defenderKnowsUturn: defKnowsUturn,
		defenderKnowsRest: defKnowsRest,
		defenderKnowsRecovery: defKnowsRecovery
	};

	var results = [];
	for (var i = 0; i < moveNames.length; i++) {
		var mn = moveNames[i];
		if (!mn || mn === "(No Move)") {
			results.push({ move: mn, score: -999, breakdown: {} });
			continue;
		}

		var mData = aiGetMoveData(mn);
		var mEffect = AI_MOVE_EFFECT[mn] || null;
		var baseScore = 100;
		var breakdown = {};

		if (trainerFlags.Basic === 1) {
			var s = scoreBasicFlag(mn, mData, mEffect, attacker, defender, context);
			if (s !== 0) breakdown.Basic = s;
			baseScore += s;
		}

		if (trainerFlags.EvaluateAttack === 1) {
			var s = scoreEvaluateAttackFlag(mn, mData, mEffect, attacker, defender, context);
			if (s !== 0) breakdown.EvaluateAttack = s;
			baseScore += s;
		}

		if (trainerFlags.Expert === 1) {
			var s = scoreExpertFlag(mn, mData, mEffect, attacker, defender, context);
			if (s !== 0) breakdown.Expert = s;
			baseScore += s;
		}

		if (trainerFlags.Setup === 1) {
			var s = scoreSetupFlag(mn, mData, mEffect, attacker, defender, context);
			if (s !== 0) breakdown.Setup = s;
			baseScore += s;
		}

		if (trainerFlags.Risky === 1) {
			var s = scoreRiskyFlag(mn, mData, mEffect, attacker, defender, context);
			if (s !== 0) breakdown.Risky = s;
			baseScore += s;
		}

		if (trainerFlags.DamagePriority === 1) {
			var s = scoreDamagePriorityFlag(mn, mData, mEffect, attacker, defender, context);
			if (s !== 0) breakdown.DamagePriority = s;
			baseScore += s;
		}

		if (trainerFlags.BatonPass === 1) {
			var s = scoreBatonPassFlag(mn, mData, mEffect, attacker, defender, context);
			if (s !== 0) breakdown.BatonPass = s;
			baseScore += s;
		}

		if (trainerFlags.TagStrategy === 1) {
			var s = scoreTagStrategyFlag(mn, mData, mEffect, attacker, defender, context);
			if (s !== 0) breakdown.TagStrategy = s;
			baseScore += s;
		}

		if (trainerFlags.CheckHP === 1) {
			var s = scoreCheckHPFlag(mn, mData, mEffect, attacker, defender, context);
			if (s !== 0) breakdown.CheckHP = s;
			baseScore += s;
		}

		if (trainerFlags.Weather === 1) {
			var s = scoreWeatherFlag(mn, mData, mEffect, attacker, defender, context);
			if (s !== 0) breakdown.Weather = s;
			baseScore += s;
		}

		if (trainerFlags.Harassment === 1) {
			var s = scoreHarassmentFlag(mn, mData, mEffect, attacker, defender, context);
			if (s !== 0) breakdown.Harassment = s;
			baseScore += s;
		}

		results.push({
			move: mn,
			score: baseScore,
			breakdown: breakdown,
			damage: moveDamages[mn] || 0
		});
	}

	// Sort by score descending
	results.sort(function(a, b) { return b.score - a.score; });

	return results;
}


function predictAIMove(attackerPokemon, defenderPokemon, trainerFlags, fieldObj, extraContext) {
	if (!attackerPokemon || !defenderPokemon || !trainerFlags) return null;

	var moveNames = [];
	if (attackerPokemon.moves) {
		for (var i = 0; i < attackerPokemon.moves.length; i++) {
			var m = attackerPokemon.moves[i];
			if (typeof m === "string") {
				moveNames.push(m);
			} else if (m && m.name) {
				moveNames.push(m.name);
			} else if (m && m.originalName) {
				moveNames.push(m.originalName);
			}
		}
	}

	if (moveNames.length === 0) return null;

	var scored = scoreAIMoves(attackerPokemon, defenderPokemon, moveNames, trainerFlags, fieldObj, extraContext);

	if (!scored || scored.length === 0) return null;

	return {
		bestMove: scored[0].move,
		bestScore: scored[0].score,
		allMoves: scored
	};
}
