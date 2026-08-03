// Hand-authored storyboard content for projects/video-004-han-quoc-dau-tu.
// Transcript: Korea's margin-trading (đòn bẩy) boom and early-2026 stock
// market crash (KOSPI -18%), household debt, jeonse housing, "gaemi" retail
// investors, CFD scandal, and closing risk/opportunity outlook.
//
// Each entry's `marker` is a verbatim phrase copied from transcript.txt
// marking where the scene's narration begins; scripts/build-storyboard.ts
// tokenizes it and finds it in-order in the transcript, slicing exact,
// non-overlapping, full-coverage sourceRanges. `narrationOverride` is used
// generously here to repair ASR errors (CPI→KOSPI, Marin→margin,
// gamy→gaemi, John Sư→Jeonse, múc→mức, and garbled run-on phrasing) while
// preserving exact meaning and figures.

import type {
  AuthoredScene, FocalType, PhotoTreatment, SemanticVisual, StoryClaim, StorySection, VisualRegister, VisualTreatmentPlan,
} from "../../src/types/storyboard";

export const CAST = {
  host: { src: "characters/cat_explain", poseFamily: "narrator" as const },
  hostPoint: { src: "characters/cat_point_left" },
  hostPlain: { src: "characters/cat" },
  hostShrug: { src: "characters/cat_shrug" },
  hostHappy: { src: "characters/cat_happy" },
  broker: { src: "characters/cat_business" },
  investor: { src: "characters/cat_investor_phone" },
  plainInvestor: { src: "characters/cat_investor_contract" },
  gaemi: { src: "characters/cat_investor_panic" },
  landlord: { src: "characters/cat_dad" },
  tenant: { src: "characters/cat_debt_burden" },
  youngperson: { src: "characters/cat_homebuyer" },
  parent: { src: "characters/cat_mom" },
  regulator: { src: "characters/cat_police" },
  analyst: { src: "characters/cat_teacher" },
  skeptic: { src: "characters/cat_sunglasses" },
  studentBoy: { src: "characters/cat_child_boy" },
  studentGirl: { src: "characters/cat_child_girl" },
  studentSchool: { src: "characters/cat_child_school" },
};

export const VISUAL_TREATMENT_PLAN: VisualTreatmentPlan = {
  registerTargets: {
    character_action: 0.25,
    full_tableau: 0.20,
    infographic: 0.18,
    evidence: 0.14,
    photo_broll: 0.13,
    framebox: 0.05,
    visual_gag: 0.05,
  },
  characterFreeTarget: 0.32,
  heroConcepts: [
    "KOSPI falling 18 percent",
    "household debt pressing against housing",
    "gaemi investors carrying borrowed money",
    "speculation flowing around regulation",
    "a young worker choosing between slow wages and leveraged risk",
  ],
  visualMotifs: [
    "red margin line cutting through otherwise white frames",
    "ant-sized investors becoming a crowd",
    "water finding a new path whenever one channel closes",
  ],
  forbiddenRepeats: [
    "dark neon statistic cards as a default",
    "two generic cards with no acted relationship",
    "the same photo or stage used as consecutive wallpaper",
    "a character standing idle beside an unrelated icon",
  ],
  usageBudgets: {
    maximumAssetUses: 10,
    maximumStageRatio: 0.05,
    maximumPoseRatio: 0.08,
    maximumConsecutiveSameStage: 2,
    maximumPhotoTreatmentRatio: 0.35,
    maximumStatRevealRatio: 0.08,
  },
  requiredVisualModes: [
    "character_action", "full_tableau", "evidence", "photo_broll",
    "infographic", "visual_gag", "screen", "document", "map",
  ],
  heroCadenceSeconds: 45,
  paletteProfile: "editorial-muted-v2",
};

type DraftScene = Omit<AuthoredScene,
  "visualRegister" | "focalType" | "semanticVisual" |
  "silentFrameTakeaway" | "focalOccupancyTarget" | "characterRequired"
>;

const BASE_SCENES: DraftScene[] = [
  { marker: "Nhắc tới Hàn Quốc ngoài kim chi, phim",
    narrationOverride: "Đầu năm 2026, chỉ trong vài ngày, KOSPI Hàn Quốc rơi hơn 18%.",
    grammar: "STAT_REVEAL", emotion: "urgent", heroVisual: true,
    purpose: "Open on the market shock before any context or branding.",
    viewerFocus: "the -18% KOSPI shock",
    slots: { stat: "-18%", anchor: "finance/trending_down", who: "characters/cat_surprised", caption: "KOSPI · chỉ vài ngày" } },

  { marker: "Những cái thứ như là cổ phiếu",
    narrationOverride: "Điều đáng sợ hơn: nhiều nhà đầu tư dùng margin rất cao, đến mức một số công ty chứng khoán phải chạm trần cho vay.",
    grammar: "EVIDENCE", emotion: "concern",
    purpose: "Name the margin ceiling and the question it raises.",
    viewerFocus: "the margin lending ceiling",
    slots: { title: "TRẦN MARGIN", body: "Có công ty chứng khoán phải tạm dừng cho vay", source: "FSC · 2025" } },

  { marker: "Hậu quả bắt đầu lộ rõ",
    narrationOverride: "Vì sao nhiều người sẵn sàng vay tiền để cược vào thị trường, và vì sao margin lại phổ biến đến thế?",
    grammar: "QA_REVEAL", emotion: "curious",
    purpose: "Put the central editorial question before the explanation.",
    viewerFocus: "the two-part question",
    slots: { q: "Vì sao phải vay để cược?", a: "Vì sao margin lại phổ biến?", who: "hostPoint" } },

  { marker: "Nhưng mà điều đáng chú ý",
    narrationOverride: "Tôi là Mèo. Đây là câu chuyện về cơn sốt đòn bẩy của Hàn Quốc.",
    grammar: "TABLEAU", emotion: "neutral",
    purpose: "Keep branding short and place it after the hook.",
    viewerFocus: "the host and episode identity",
    slots: { stage: "assets/scenes/library.svg", who: "hostPlain", anchorA: "table", prop: "props/book" } },

  { marker: "Nhưng mà tại sao cái chuyện này",
    narrationOverride: "Trước hết, cần hiểu margin: bạn mượn tiền của công ty chứng khoán để mua nhiều cổ phiếu hơn số vốn thật có.",
    grammar: "TABLEAU", emotion: "curious",
    purpose: "Begin explaining margin before 40 seconds.",
    viewerFocus: "borrowed buying power",
    slots: { stage: "assets/scenes/office_desk.svg", who: "hostShrug", anchorA: "desk", prop: "finance/money", propPlacement: "right" } },

  { marker: "Tại sao mà nhiều người",
    grammar: "QA_REVEAL", emotion: "curious",
    purpose: "State the video's core question before the branding beat.",
    viewerFocus: "the twin questions",
    slots: { q: "Tại sao sẵn sàng vay tiền để cược?", a: "Và tại sao margin lại phổ biến đến thế?", who: "hostPoint" } },

  { marker: "Tôi là nhèo",
    narrationOverride: "Tôi là Mèo, và đây là câu chuyện về cơn sốt đòn bẩy của Hàn Quốc.",
    grammar: "TABLEAU", emotion: "neutral",
    purpose: "Channel branding beat.",
    viewerFocus: "the host introducing the series",
    slots: { stage: "assets/scenes/library.svg", who: "hostPlain", anchorA: "table", prop: "props/book", caption: "Cơn sốt đòn bẩy Hàn Quốc" } },

  { marker: "Trước tiên thì chúng ta đã cần tìm hiểu",
    grammar: "TABLEAU", emotion: "neutral",
    purpose: "Transition into the explainer section: what is margin.",
    viewerFocus: "the host, ready to explain",
    slots: { stage: "assets/scenes/library.svg", who: "hostPoint", anchorA: "table", prop: "finance/debt", caption: "Margin (đòn bẩy) là gì?" } },

  { marker: "Marin hay là giao dịch ký quỹ",
    narrationOverride: "Margin, hay giao dịch ký quỹ, nói đơn giản là vay tiền từ công ty chứng khoán để mua thêm cổ phiếu.",
    grammar: "CHAR_PROP", emotion: "neutral",
    purpose: "Define margin concretely with a prop.",
    viewerFocus: "the loan prop", slots: { who: "hostPlain", prop: "finance/loan", label: "Vay tiền để mua thêm cổ phiếu" } },

  { marker: "Ví dụ như là bạn có 100 triệu",
    grammar: "DIALOGUE_QA", emotion: "neutral",
    purpose: "Worked example: 100 triệu vốn → 200 triệu sức mua.",
    viewerFocus: "vốn vs. sức mua sau vay",
    slots: { asker: "hostPoint", answerer: "investor", askerText: "Bạn có 100 triệu?", answererText: "Vay thêm, tôi mua được 200.", stage: "assets/scenes/office_desk.svg", anchorA: "desk", anchorB: "desk_right" } },

  { marker: "Nếu mà cổ phiếu tăng 10%",
    grammar: "STAT_REVEAL", emotion: "neutral",
    purpose: "Show the upside multiplier of margin.",
    viewerFocus: "gains doubled",
    slots: { stat: "20 TRIỆU", anchor: "finance/chart_up", who: "hostHappy", caption: "Lãi gấp đôi nhờ vay thêm" } },

  { marker: "Nhưng mà vấn đề không phải là bạn cứ vay tiền",
    grammar: "STAT_REVEAL", emotion: "sad",
    purpose: "Flip to the downside — losses double too, debt stays fixed.",
    viewerFocus: "losses doubled",
    slots: { stat: "LỖ x2", anchor: "finance/loss", who: "characters/cat_sad", caption: "và tiền vay + lãi vay vẫn phải trả đủ" } },

  { marker: "Marin về bản chất thì nó giống như cái việc là gắn động cơ xe đua",
    narrationOverride: "Margin về bản chất giống như việc gắn một động cơ đua vào danh mục đầu tư của bạn. Chạy đúng hướng thì rất đã, nhưng chỉ cần cua gấp một cái là bạn có thể văng thẳng ra khỏi đường đua.",
    grammar: "VISUAL_METAPHOR", emotion: "concern",
    purpose: "Metaphor for margin's amplifying, destabilizing nature.",
    viewerFocus: "engine metaphor for margin",
    slots: { setup: "Gắn động cơ đua vào đầu tư", payoff: "Cua gấp là văng khỏi đường đua", leftAsset: "finance/chart_up", rightAsset: "finance/loss" } },

  { marker: "Và cái thứ nguy hiểm nhất gọi là margin core",
    narrationOverride: "Và thứ nguy hiểm nhất gọi là margin call, hay lệnh gọi ký quỹ.",
    grammar: "FRAMEBOX", emotion: "surprise",
    purpose: "Name the mechanism that turns leverage lethal.",
    viewerFocus: "the term margin call", slots: { content: "#E74C3C", caption: "MARGIN CALL", who: "host" } },

  { marker: "Khi mà tài sản trong tài khoản giảm xuống dưới mức an toàn",
    narrationOverride: "Khi tài sản trong tài khoản giảm xuống dưới mức an toàn, công ty chứng khoán sẽ yêu cầu bạn nộp thêm tiền. Nếu bạn không nộp kịp, họ có quyền bán cổ phiếu để thu hồi khoản vay, bất kể lúc đó giá đang đẹp hay xấu.",
    grammar: "DIALOGUE_QA", emotion: "concern",
    purpose: "Explain the forced-sell mechanism precisely.",
    viewerFocus: "forced liquidation",
    slots: { asker: "broker", answerer: "skeptic", askerText: "Nộp thêm tiền, ngay bây giờ.", answererText: "Không đủ? Cổ phiếu bị bán.", stage: "assets/scenes/office_desk.svg", anchorA: "desk", anchorB: "desk_right" } },

  { marker: "Và vấn đề nó thường nằm ở đây",
    narrationOverride: "Và vấn đề thường nằm ở đây: trong một thị trường lao dốc, hàng chục nghìn người có thể cùng nhận margin call. Mọi người cùng bán thì giá càng giảm mạnh hơn, mà giá càng giảm thì càng nhiều người lại bị margin call.",
    grammar: "DIALOGUE_QA", emotion: "urgent",
    purpose: "Dramatize the cascade as a broker-investor exchange.",
    viewerFocus: "the forced-sell demand",
    slots: { asker: "broker", askerText: "Anh phải nộp thêm tiền ngay!", answerer: "investor", answererText: "Tôi... không đủ tiền nộp.", stage: "assets/scenes/boardroom.svg", anchorA: "seat_left", anchorB: "seat_right" } },

  { marker: "Rồi nó lại xuất hiện thêm những cái đợt bán tháo mới",
    grammar: "VISUAL_METAPHOR", emotion: "urgent",
    purpose: "The staircase-fall metaphor for cascading margin calls.",
    viewerFocus: "one person falling, then a chain of falls",
    slots: { setup: "Một người ngã trên cầu thang", payoff: "Cả hàng người ngã theo sau", leftAsset: "characters/cat_sad", rightAsset: "finance/trending_down" } },

  { marker: "Và đó chính xác là những gì đã xảy ra",
    grammar: "PHOTO_EVIDENCE", emotion: "sad", heroVisual: true,
    purpose: "Emotional-punch photo beat — the margin-call cascade climax, real photo, no character overlay.",
    viewerFocus: "a real trading-floor image",
    slots: { photo: "backgrounds/office_trading.jpg", caption: "Cú sập bắt đầu từ cách cả một thế hệ nhìn nhận việc làm giàu" } },

  { marker: "Hàn Quốc hiện nay là một trong những quốc gia",
    grammar: "STAT_REVEAL", emotion: "surprise",
    purpose: "Root-cause pivot: household debt near GDP.",
    viewerFocus: "debt approaching GDP",
    slots: { stat: "NỢ ≈ GDP", anchor: "finance/debt", who: "characters/cat_surprised", caption: "Nợ hộ gia đình cao nhất thế giới" } },

  { marker: "Cuối năm 2025 thì tổng nợ tín dụng hộ gia đình",
    narrationOverride: "Cuối năm 2025, tổng nợ tín dụng hộ gia đình của Hàn Quốc đã tiến sát mức 2.000 tỷ đô la — một con số khổng lồ.",
    grammar: "STAT_REVEAL", emotion: "surprise", heroVisual: true,
    purpose: "Land the household-debt hero number.",
    viewerFocus: "the 2000-tỷ figure",
    slots: { stat: "2.000 TỶ $", anchor: "finance/debt", who: "characters/cat_surprised", caption: "Tổng nợ hộ gia đình, cuối 2025" } },

  { marker: "Và cái điều đangng nói là phần lớn",
    narrationOverride: "Và điều đáng nói là phần lớn số nợ đó liên quan đến nhà ở.",
    grammar: "PHOTO_EVIDENCE", emotion: "concern",
    purpose: "Point the debt story at housing.",
    viewerFocus: "debt tied to housing",
    slots: { photo: "backgrounds/korea_apartments.jpg", caption: "Phần lớn nợ hộ gia đình gắn với nhà ở" } },

  { marker: "Hàn Quốc có một mô hình thuê nhà khá đặc biệt",
    narrationOverride: "Hàn Quốc có một mô hình thuê nhà khá đặc biệt gọi là Jeonse. Thay vì trả tiền thuê hằng tháng, người thuê sẽ đưa cho chủ nhà một khoản tiền đặt cọc rất lớn.",
    grammar: "TABLEAU", emotion: "neutral",
    purpose: "Introduce Jeonse with landlord and tenant staged together.",
    viewerFocus: "landlord and tenant at the deposit handoff",
    slots: { stage: "assets/scenes/living_room.svg", who: "landlord", anchorA: "sofa_left", seatB: "tenant", anchorB: "sofa_right", caption: "Jeonse: đặt cọc lớn thay tiền thuê" } },

  { marker: "Nhiều trường hợp là lên tới một nửa giá trị",
    grammar: "STAT_REVEAL", emotion: "surprise",
    purpose: "Quantify how large the jeonse deposit can be.",
    viewerFocus: "50% of a home's value",
    slots: { stat: "50%", anchor: "finance/house", who: "characters/cat_surprised", caption: "giá trị căn nhà, trả trước dưới dạng đặt cọc" } },

  { marker: "Nghe hợp lý mà có mà có một cái vấn đề",
    narrationOverride: "Nghe hợp lý đấy, nhưng có một vấn đề: khoản tiền ban đầu rất lớn. Muốn thuê được nhà, bạn phải có sẵn một khoản tiền lớn.",
    grammar: "TABLEAU", emotion: "concern",
    purpose: "Flag the barrier to entry in jeonse.",
    viewerFocus: "the upfront cash requirement",
    slots: { stage: "assets/scenes/bank_interior.svg", who: "hostPlain", anchorA: "counter_left", prop: "finance/money", caption: "Cần sẵn một khoản tiền lớn" } },

  { marker: "Trong cái thời mà lãi suất thấp thì chỗ này",
    narrationOverride: "Trong thời lãi suất thấp thì chuyện này cũng ổn — tiền rẻ, chủ nhà có thể đem tiền đặt cọc đi đầu tư, người thuê không phải trả tiền hàng tháng, ai cũng vui.",
    grammar: "TABLEAU", emotion: "hopeful",
    purpose: "Show the system working fine when rates are low.",
    viewerFocus: "everyone happy under low rates",
    slots: { stage: "assets/scenes/living_room.svg", who: "landlord", anchorA: "sofa_left", prop: "finance/interest_rate", propPlacement: "right", propScale: "1.05", caption: "Lãi suất thấp: ai cũng vui" } },

  { marker: "nhưng mà khi lãi suất tăng ấy thì nhiều chủ nhà",
    narrationOverride: "Nhưng khi lãi suất tăng, nhiều chủ nhà bắt đầu gặp khó khăn trả lại tiền cọc khi hợp đồng kết thúc — và người chịu áp lực đầu tiên thường là người đi thuê.",
    grammar: "DIALOGUE_QA", emotion: "concern",
    purpose: "Show the system breaking when rates rise.",
    viewerFocus: "rates rising, deposits stuck",
    slots: { asker: "tenant", answerer: "landlord", askerText: "Tiền cọc của tôi đâu?", answererText: "Lãi tăng, tôi chưa trả nổi.", stage: "assets/scenes/living_room.svg", anchorA: "sofa_left", anchorB: "sofa_right" } },

  { marker: "và nếu bạn là người trẻ thì câu chuyện",
    grammar: "STAT_REVEAL", emotion: "sad",
    purpose: "Layer on youth employment weakness.",
    viewerFocus: "youth employment lagging",
    slots: { stat: "VIỆC LÀM THẤP HƠN", anchor: "finance/expense", who: "characters/cat_sad", caption: "Thanh niên khó tìm việc ổn định" } },

  { marker: "Rất nhiều người phải làm việc theo hợp đồng ngắn hạn",
    grammar: "DIALOGUE_QA", emotion: "sad",
    purpose: "Three symptoms of precarious youth employment.",
    viewerFocus: "the three job precarity symptoms",
    slots: { asker: "host", answerer: "studentSchool", askerText: "Công việc của bạn ổn định chứ?", answererText: "Hợp đồng ngắn, ca bán thời gian.", stage: "assets/scenes/cafe.svg", anchorA: "counter_left", anchorB: "counter_right" } },

  { marker: "Và điều này tạo ra một cảm giác khá là phổ biến",
    grammar: "PHOTO_EVIDENCE", emotion: "sad",
    purpose: "Name the generational gap feeling.",
    viewerFocus: "falling behind despite hard work",
    slots: { photo: "backgrounds/urban_apartments.jpg", caption: "Chăm chỉ vẫn tụt lại phía sau" } },

  { marker: "Mua nhà ngày càng khó, tích lũy tài sản",
    grammar: "DIALOGUE_QA", emotion: "sad",
    purpose: "Contrast parents' generation vs. today's youth.",
    viewerFocus: "the growing generational wealth gap",
    slots: { asker: "studentGirl", answerer: "parent", askerText: "Ngày trước mua nhà dễ vậy?", answererText: "Giờ khoảng cách đã khác xa.", stage: "assets/scenes/living_room.svg", anchorA: "sofa_left", anchorB: "sofa_right" } },

  { marker: "Và trong bối cảnh như thế thì thị trường tài chính",
    narrationOverride: "Trong bối cảnh đó, thị trường tài chính trông rất hấp dẫn. Ngoài việc muốn làm giàu nhanh, nhiều người còn cảm thấy họ không còn nhiều lựa chọn khác.",
    grammar: "TABLEAU", emotion: "concern",
    purpose: "Pivot: markets look like the only remaining option.",
    viewerFocus: "no other options left",
    slots: { stage: "assets/scenes/street.svg", who: "hostPlain", anchorA: "sidewalk_left", prop: "finance/stock", caption: "Không còn nhiều lựa chọn khác" } },

  { marker: "Nếu mà tiền lương mà tăng chậm hơn giá tài sản",
    grammar: "CHAR_PROP", emotion: "concern",
    purpose: "Wages lagging assets pushes people toward stocks.",
    viewerFocus: "wages vs. asset prices gap",
    slots: { who: "youngperson", prop: "finance/stock", label: "Lương chậm, tài sản chạy nhanh" } },

  { marker: "Còn Marin thì giống như kiểu là đưa cho bạn một cái xe máy",
    narrationOverride: "Còn margin thì giống như đưa cho bạn một chiếc xe nhanh hơn để đi con đường tắt đó. Nhưng tốc độ cao luôn đi kèm rủi ro cao.",
    grammar: "CHAR_PROP", emotion: "concern",
    purpose: "Margin as the faster, riskier vehicle metaphor.",
    viewerFocus: "speed vs. risk",
    slots: { who: "plainInvestor", prop: "finance/loan", label: "Tốc độ cao = rủi ro cao" } },

  { marker: "và người trẻ Hàn Quốc có một cách dẫn đạt",
    narrationOverride: "Người trẻ Hàn Quốc có một cách diễn đạt khá thú vị cho cảm giác này: cảm giác bị bỏ lại phía sau.",
    grammar: "PHOTO_EVIDENCE", emotion: "sad",
    purpose: "Name the 'left behind' feeling that drives risk-taking.",
    viewerFocus: "being left behind",
    slots: { photo: "backgrounds/city_skyline.jpg", caption: "Cảm giác bị bỏ lại phía sau" } },

  { marker: "Mọi thứ xung quanh đều tăng tốc, giá nhà",
    grammar: "DIALOGUE_QA", emotion: "sad",
    purpose: "Those with assets get richer, those without stand still.",
    viewerFocus: "asset-holders vs. everyone else",
    slots: { asker: "studentGirl", answerer: "landlord", askerText: "Sao tài sản cứ chạy xa?", answererText: "Người sở hữu giàu lên trước.", stage: "assets/scenes/street.svg", anchorA: "sidewalk_left", anchorB: "sidewalk_right" } },

  { marker: "Và khi mà cảm giác đó đã lan rộng ra cả một thế hệ",
    grammar: "TABLEAU", emotion: "concern",
    purpose: "That feeling reshapes an entire generation's financial choices.",
    viewerFocus: "generation-wide behavior shift",
    slots: { stage: "assets/scenes/street.svg", who: "hostShrug", anchorA: "sidewalk_right", prop: "people/person", propPlacement: "left", propScale: "0.9", caption: "Cả thế hệ đổi cách quyết định" } },

  { marker: "Họ sẽ lao vào sau khi đã đọc được vài cuốn sách",
    grammar: "CHAR_PROP", emotion: "urgent",
    purpose: "The three things chasing people into the market.",
    viewerFocus: "time, housing, cost of living all chasing you",
    slots: { who: "youngperson", prop: "props/hourglass", label: "Thời gian, giá nhà, chi phí cùng đuổi" } },

  { marker: "và nếu mà không chạy nhanh hơn ấ thì khoảng cách",
    grammar: "TABLEAU", emotion: "sad",
    purpose: "The stakes of not keeping up.",
    viewerFocus: "the widening gap",
    slots: { stage: "assets/scenes/subway_platform.svg", who: "host", anchorA: "stand_left", prop: "props/hourglass", caption: "Không chạy nhanh hơn = tụt xa hơn" } },

  { marker: "Nhưng mà đó mới chỉ là một nửa câu chuyện",
    grammar: "TABLEAU", emotion: "neutral",
    purpose: "Pivot to part two: market structure itself.",
    viewerFocus: "the second half of the story",
    slots: { stage: "assets/scenes/boardroom.svg", who: "hostPoint", anchorA: "center", prop: "finance/chart_up", caption: "Nửa còn lại: cấu trúc thị trường" } },

  { marker: "Một cái đặc điểm khá là khác thường của chứng khoán",
    grammar: "STAT_REVEAL", emotion: "neutral",
    purpose: "Korea's stock market is unusually retail-dominated.",
    viewerFocus: "retail investors dominate",
    slots: { stat: "NHÀ ĐẦU TƯ CÁ NHÂN", anchor: "characters/cat", who: "characters/cat_surprised", caption: "Chiếm tỉ trọng rất lớn" } },

  { marker: "Ở nhiều thị trường phát triển ý thì phần lớn",
    grammar: "DIALOGUE_QA", emotion: "neutral",
    purpose: "Contrast developed markets (institutions) vs. Korea (retail).",
    viewerFocus: "institutions vs. retail dominance",
    slots: { asker: "broker", answerer: "investor", askerText: "Ai dẫn dắt thị trường?", answererText: "Ở Hàn Quốc, nhà đầu tư lẻ.", stage: "assets/scenes/boardroom.svg", anchorA: "seat_left", anchorB: "seat_right" } },

  { marker: "Còn ở Hàn Quốc ấy thì trong nhiều năm",
    grammar: "STAT_REVEAL", emotion: "neutral",
    purpose: "2020 data point: 2/3 of trading volume.",
    viewerFocus: "2/3 of 2020 volume",
    slots: { stat: "2/3", anchor: "finance/chart_up", who: "analyst", caption: "Khối lượng giao dịch năm 2020" } },

  { marker: "Đến năm 26 thì con số này vẫn thường xuyên",
    narrationOverride: "Đến năm 2026, con số này vẫn thường xuyên dao động quanh mức 60%. Tức là cứ 10 lệnh mua bán trên thị trường thì có sáu lệnh đến từ nhà đầu tư cá nhân.",
    grammar: "STAT_REVEAL", emotion: "neutral",
    purpose: "2026 data point: still 60% of orders.",
    viewerFocus: "60% of orders in 2026",
    slots: { stat: "60%", anchor: "finance/portfolio", who: "broker", caption: "Lệnh mua bán năm 2026" } },

  { marker: "Đây là một tỉ lệ rất là cao và nó kéo thêm",
    grammar: "DIALOGUE_QA", emotion: "hopeful",
    purpose: "Retail euphoria drives money in fast.",
    viewerFocus: "euphoria pushing money in",
    slots: { asker: "host", answerer: "investor", askerText: "Giá đang tăng, anh làm gì?", answererText: "Tôi đổ tiền vào ngay!", stage: "assets/scenes/office_desk.svg", anchorA: "desk", anchorB: "desk_right" } },

  { marker: "Và khi mà họ hoảng loạn ấ thì lực bán",
    narrationOverride: "Và khi họ hoảng loạn, lực bán cũng xuất hiện với tốc độ tương tự. Thị trường vì thế phản ứng nhạy hơn nhiều với tâm lý đám đông.",
    grammar: "DIALOGUE_QA", emotion: "urgent",
    purpose: "Panic drives selling just as fast — market volatility source.",
    viewerFocus: "panic driving equally fast selling",
    slots: { asker: "host", answerer: "investor", askerText: "Thị trường quay đầu rồi!", answererText: "Bán ngay trước đám đông!", stage: "assets/scenes/street.svg", anchorA: "sidewalk_left", anchorB: "sidewalk_right" } },

  { marker: "Người Hàn Quốc thậm chí còn có một cái biệt danh",
    narrationOverride: "Người Hàn Quốc thậm chí có một biệt danh cho nhóm nhà đầu tư này: \"gaemi\", nghĩa là đàn kiến.",
    grammar: "TABLEAU", emotion: "neutral", heroVisual: true,
    purpose: "The gaemi ants reveal — a defining hero beat.",
    viewerFocus: "the nickname reveal",
    slots: { stage: "assets/scenes/street.svg", who: "hostPoint", anchorA: "sidewalk", prop: "people/person", caption: "\"Gaemi\" — đàn kiến" } },

  { marker: "Nghe kiểu cái kiến nhỏ nhỏ các thứ",
    narrationOverride: "Nghe thì có vẻ nhỏ bé, nhưng nếu một triệu con kiến cùng chạy về một hướng, chúng cũng tạo ra một lực đẩy rất lớn.",
    grammar: "VISUAL_METAPHOR", emotion: "surprise",
    purpose: "One ant vs. a million ants moving together.",
    viewerFocus: "small ants, huge combined force",
    slots: { setup: "Một con kiến rất nhỏ", payoff: "Triệu con kiến cùng hướng = lực đẩy khổng lồ", leftAsset: "characters/cat", rightAsset: "finance/chart_up" } },

  { marker: "Đặc biệt là khi phần lớn trong số đó",
    grammar: "TABLEAU", emotion: "concern",
    purpose: "The ants are carrying margin — danger multiplier.",
    viewerFocus: "ants carrying leverage",
    slots: { stage: "assets/scenes/park.svg", who: "hostHappy", anchorA: "bench_left", prop: "finance/debt", caption: "Đàn kiến mang theo margin" } },

  { marker: "Những nghiên cứu về hành vi đầu tư tại Hàn Quốc",
    grammar: "EVIDENCE", emotion: "neutral",
    purpose: "Cite behavioral research on retail mistakes.",
    viewerFocus: "the research citation",
    slots: { title: "Nghiên cứu hành vi đầu tư", body: "Nhà đầu tư cá nhân dễ mắc sai lầm quen thuộc, dễ bị cuốn theo đám đông" } },

  { marker: "Thấy người khác mua thì cũng phomo",
    narrationOverride: "Thấy người khác mua thì cũng FOMO, thấy cổ phiếu tăng mạnh thì cũng FOMO.",
    grammar: "FRAMEBOX", emotion: "surprise",
    purpose: "Name FOMO as the first behavioral trap.",
    viewerFocus: "FOMO buying", slots: { content: "#9B59B6", caption: "FOMO", who: "investor" } },

  { marker: "Nhiều người lại thích săn những mã cổ phiếu nhỏ",
    grammar: "VISUAL_METAPHOR", emotion: "concern",
    purpose: "Chasing small risky stocks like a lottery ticket.",
    viewerFocus: "lottery-ticket investing",
    slots: { setup: "Săn cổ phiếu nhỏ, rủi ro cao", payoff: "Như mua vé số, hy vọng trúng độc đắc", leftAsset: "finance/stock", rightAsset: "finance/investment" } },

  { marker: "Một cái xu hướng khác cũng khá phổ biến là bán quá sớm",
    grammar: "DIALOGUE_QA", emotion: "concern",
    purpose: "Behavioral bias: sell winners early, hold losers.",
    viewerFocus: "disposition effect",
    slots: { asker: "skeptic", answerer: "investor", askerText: "Mã lời thì sao?", answererText: "Bán sớm; mã lỗ thì giữ.", stage: "assets/scenes/cafe.svg", anchorA: "counter_left", anchorB: "counter_right" } },

  { marker: "Đây là một cái hiện tượng rất là nổi tiếng trong tài chính hành vi",
    grammar: "TABLEAU", emotion: "neutral",
    purpose: "Note this bias is global, not unique to Korea.",
    viewerFocus: "a well-known global phenomenon",
    slots: { stage: "assets/scenes/library.svg", who: "analyst", anchorA: "table_left", prop: "props/book", caption: "Hiện tượng phổ biến toàn cầu" } },

  { marker: "Nhưng mà ở Hàn Quốc ấy thì mọi thứ lại cực đoan hơn",
    narrationOverride: "Nhưng ở Hàn Quốc, mọi thứ cực đoan hơn khi margin xuất hiện, bởi nhóm dùng margin thường chính là nhóm giao dịch tích cực nhất.",
    grammar: "PHOTO_EVIDENCE", emotion: "concern",
    purpose: "Margin amplifies the bias in Korea specifically.",
    viewerFocus: "margin users are the most active traders",
    slots: { photo: "backgrounds/market_monitor.jpg", caption: "Margin: nhóm giao dịch tích cực nhất" } },

  { marker: "Theo những nghiên cứu tại KCMI",
    grammar: "EVIDENCE", emotion: "neutral",
    purpose: "Cite KCMI research on margin users' outsized activity.",
    viewerFocus: "the KCMI data point",
    slots: { title: "Nghiên cứu tại KCMI", body: "Người dùng margin: số lượng ít, nhưng khối lượng giao dịch vượt trội" } },

  { marker: "Tại vì là đội này thì mua bán thường xuyên hơn",
    grammar: "DIALOGUE_QA", emotion: "concern",
    purpose: "Three traits of the margin-heavy trading group.",
    viewerFocus: "frequent trading, volatile stocks, concentrated risk",
    slots: { asker: "broker", answerer: "investor", askerText: "Dùng margin thì giao dịch sao?", answererText: "Nhiều hơn, lớn hơn, rủi ro hơn.", stage: "assets/scenes/office_desk.svg", anchorA: "desk", anchorB: "desk_right" } },

  { marker: "Tức là đây là cái nhóm mà đạp ga mạnh nhất",
    narrationOverride: "Đây là nhóm 'đạp ga' mạnh nhất trên thị trường. Nhưng vấn đề là chiếc xe của họ lại chạy bằng tiền đi vay.",
    grammar: "CHAR_PROP", emotion: "concern",
    purpose: "The most aggressive traders run on borrowed money.",
    viewerFocus: "borrowed money fueling the fastest traders",
    slots: { who: "skeptic", prop: "finance/loan", label: "Đạp ga mạnh nhất — bằng tiền đi vay" } },

  { marker: "Thì khi mà thị trường ổn ngon thì không sao",
    grammar: "DIALOGUE_QA", emotion: "concern",
    purpose: "Good markets reward them most; crashes hurt them first.",
    viewerFocus: "asymmetric upside/downside for margin users",
    slots: { asker: "hostShrug", answerer: "investor", askerText: "Margin khi thị trường tốt?", answererText: "Lãi trước; sập cũng ngã trước.", stage: "assets/scenes/street.svg", anchorA: "sidewalk_left", anchorB: "sidewalk_right" } },

  { marker: "Và cái điều buồn cười là sau khi cộng tất cả",
    grammar: "STAT_REVEAL", emotion: "sarcastic",
    purpose: "Net of fees and interest, margin users don't even outperform.",
    viewerFocus: "underperformance after costs",
    slots: { stat: "HIỆU QUẢ THẤP HƠN", anchor: "finance/loss", who: "characters/cat_shrug", caption: "Sau phí giao dịch và lãi vay" } },

  { marker: "Tức là họ chấp nhận nhiều rủi ro hơn, căng thẳng hơn",
    grammar: "PHOTO_EVIDENCE", emotion: "sarcastic",
    purpose: "State the paradox plainly.",
    viewerFocus: "more risk, more stress, no better results",
    slots: { photo: "backgrounds/money_counting.jpg", caption: "Rủi ro cao hơn, kết quả không tốt hơn" } },

  { marker: "Thế thì tại sao nhiều nhà đầu tư Hàn Quốc lại sẵn sàng",
    grammar: "QA_REVEAL", emotion: "curious",
    purpose: "Pivot to the 'why' section — root causes.",
    viewerFocus: "why take such a big bet",
    slots: { q: "Tại sao vẫn sẵn sàng cược lớn?", a: "Có bốn nguyên nhân chính...", who: "analyst" } },

  { marker: "Đầu tiên là áp lực tài sản",
    grammar: "CHAR_PROP", emotion: "neutral",
    purpose: "Preview the four root causes before detailing each.",
    viewerFocus: "the four causes overview",
    slots: { who: "hostPoint", prop: "props/concept_card", label: "Bốn gốc rễ của cơn sốt" } },

  { marker: "Và chứng khoán là một trong những số ít nơi",
    grammar: "TABLEAU", emotion: "concern",
    purpose: "Stocks feel like the last real shot at closing the wealth gap.",
    viewerFocus: "stocks as a last chance",
    slots: { stage: "assets/scenes/office_desk.svg", who: "regulator", anchorA: "desk", prop: "finance/stock", caption: "Chứng khoán = cơ hội đổi đời" } },

  { marker: "Chỉ cần cái điện thoại, một tài khoản giao dịch",
    narrationOverride: "Chỉ cần một chiếc điện thoại, một tài khoản giao dịch, bấm vài nút là đã có thể tham gia cuộc chơi.",
    grammar: "CHAR_PROP", emotion: "neutral",
    purpose: "Show how frictionless entry has become.",
    viewerFocus: "entering the market in seconds",
    slots: { who: "plainInvestor", prop: "finance/investment", label: "Chỉ cần vài cú chạm để tham gia" } },

  { marker: "Trong suy nghĩ của nhiều người trẻ thì đây gần như",
    grammar: "PHOTO_EVIDENCE", emotion: "sad",
    purpose: "Framing: this feels like the last real chance.",
    viewerFocus: "the last realistic chance",
    slots: { photo: "backgrounds/home_study.jpg", caption: "Cơ hội thực tế cuối cùng để đổi đời" } },

  { marker: "Và cũng như đã nói rất là nhiều rồi thì cơ hội lớn",
    grammar: "DIALOGUE_QA", emotion: "concern",
    purpose: "Big opportunity, bigger risk — margin makes both extreme.",
    viewerFocus: "opportunity vs. amplified risk",
    slots: { asker: "hostHappy", answerer: "studentBoy", askerText: "Cơ hội có lớn không?", answererText: "Có, nhưng margin làm rủi ro lớn hơn." } },

  { marker: "Gốc rễ thứ hai là một khái niệm rất là nổi tiếng",
    narrationOverride: "Gốc rễ thứ hai là một khái niệm nổi tiếng ở Hàn Quốc: \"Korea Discount\".",
    grammar: "FRAMEBOX", emotion: "neutral",
    purpose: "Introduce Korea Discount as root cause #2.",
    viewerFocus: "the term Korea Discount", slots: { content: "#2C3E50", caption: "\"Korea Discount\"", who: "analyst" } },

  { marker: "Đây là cách mà giới đầu tư mô tả về cổ phiếu",
    grammar: "DIALOGUE_QA", emotion: "neutral",
    purpose: "Korean stocks trade at a discount to comparable foreign firms.",
    viewerFocus: "Korean stocks undervalued vs. peers abroad",
    slots: { asker: "plainInvestor", answerer: "analyst", askerText: "Cổ phiếu Hàn rẻ hơn?", answererText: "Thường rẻ hơn doanh nghiệp tương tự.", stage: "assets/scenes/boardroom.svg", anchorA: "seat_left", anchorB: "seat_right" } },

  { marker: "Nguyên nhân thì là một phần đến từ cấu trúc",
    narrationOverride: "Nguyên nhân một phần đến từ cấu trúc của các tập đoàn chaebol, một phần đến từ tranh cãi kéo dài về quyền lợi cổ đông nhỏ.",
    grammar: "DIAGRAM", emotion: "neutral",
    purpose: "Two structural causes of the Korea Discount.",
    viewerFocus: "chaebol structure and shareholder disputes",
    slots: { items: "Cấu trúc tập đoàn chaebol|Tranh cãi quyền cổ đông nhỏ", icons: "people/company|finance/stock" } },

  { marker: "Nhưng mà cái điều quan trọng là nhiều nhà đầu tư tin rằng",
    grammar: "TABLEAU", emotion: "concern",
    purpose: "Belief in the discount pushes people to short-term trading.",
    viewerFocus: "distrust in long-term holding",
    slots: { stage: "assets/scenes/office_desk.svg", who: "analyst", anchorA: "desk_right", prop: "props/calendar", caption: "Không tin dài hạn, chơi ngắn hạn" } },

  { marker: "Yếu tố thứ ba là câu chuyện bán khống",
    grammar: "TABLEAU", emotion: "neutral",
    purpose: "Introduce short selling as root cause #3.",
    viewerFocus: "the term short selling",
    slots: { stage: "assets/scenes/boardroom.svg", who: "regulator", anchorA: "center", prop: "finance/stock", caption: "Bán khống (Short Selling)" } },

  { marker: "Về lý thuyết thì đây là một công cụ hoàn toàn bình thường",
    grammar: "EVIDENCE", emotion: "neutral",
    purpose: "Short selling's legitimate theoretical role.",
    viewerFocus: "the theoretical case for short selling",
    slots: { title: "Về lý thuyết", body: "Bán khống giúp phát hiện giá phi lý, hạn chế cổ phiếu bị thổi phồng" } },

  { marker: "Nhưng mà trong mắt nhiều nhà đầu tư cá nhân của Hàn Quốc",
    grammar: "DIALOGUE_QA", emotion: "concern",
    purpose: "Retail sees short selling as a rigged playing field.",
    viewerFocus: "retail vs. foreign institutional funds",
    slots: { asker: "skeptic", answerer: "regulator", askerText: "Luật chơi có công bằng?", answererText: "Nhà đầu tư lẻ không tin vậy.", stage: "assets/scenes/courtroom.svg", anchorA: "stand_left", anchorB: "bench_right" } },

  { marker: "Những cái bê bối liên quan đến bán khống",
    grammar: "TABLEAU", emotion: "sad",
    purpose: "Scandals deepen distrust of fairness.",
    viewerFocus: "short-selling scandals eroding trust",
    slots: { stage: "assets/scenes/courtroom.svg", who: "host", anchorA: "stand", prop: "finance/loss", caption: "Bê bối bán khống, nghi ngờ tăng" } },

  { marker: "Và khi mà niềm tin và tính công bằng của thị trường",
    grammar: "CHAR_PROP", emotion: "concern",
    purpose: "Eroded fairness pushes people to grab quick gains.",
    viewerFocus: "distrust driving short-termism",
    slots: { who: "skeptic", prop: "finance/loss", label: "Mất niềm tin, chuyển sang kiếm nhanh" } },

  { marker: "Và cuối cùng cũng là yếu tố quan trọng nhất",
    grammar: "PHOTO_EVIDENCE", emotion: "neutral",
    purpose: "Root cause #4: sheer ease of access.",
    viewerFocus: "accessibility as the most important factor",
    slots: { photo: "backgrounds/mobile_trading_flatlay.jpg", caption: "Yếu tố quan trọng nhất: quá dễ" } },

  { marker: "Ngày trước mà muốn mua bán cổ phiếu thì phải gọi điện",
    grammar: "TABLEAU", emotion: "neutral",
    purpose: "Old friction: calling a broker, paying high fees.",
    viewerFocus: "the old way of trading",
    slots: { stage: "assets/scenes/office_desk.svg", who: "broker", anchorA: "desk", prop: "props/computer_desk", caption: "Ngày xưa: gọi môi giới, phí cao" } },

  { marker: "Còn bây giờ thì cứ điện thoại thôi",
    grammar: "DIALOGUE_QA", emotion: "neutral",
    purpose: "Contrast old friction vs. today's instant trading.",
    viewerFocus: "seconds to trade today",
    slots: { asker: "broker", answerer: "investor", askerText: "Ngày trước phải gọi tôi.", answererText: "Giờ vài giây trên điện thoại.", stage: "assets/scenes/office_desk.svg", anchorA: "desk", anchorB: "desk_right" } },

  { marker: "Thêm vào đấy thì những cái nội dung tài chính",
    grammar: "CHAR_PROP", emotion: "neutral",
    purpose: "Financial content is everywhere, reinforcing the pull.",
    viewerFocus: "constant financial content",
    slots: { who: "skeptic", prop: "props/computer_desk", label: "Video, livestream, diễn đàn ở khắp nơi" } },

  { marker: "Mỗi ngày thì người ta liên tục được nhắc",
    grammar: "DIALOGUE_QA", emotion: "sarcastic",
    purpose: "Dramatize the hype-chatter pulling people in daily.",
    viewerFocus: "hype talk between traders",
    slots: { asker: "broker", askerText: "Mã này sắp tăng rồi anh em ơi!", answerer: "skeptic", answererText: "Sắp có sóng mới thật à?", stage: "assets/scenes/cafe.svg", anchorA: "counter_left", anchorB: "counter_right" } },

  { marker: "Và khi mà tất cả những cái thứ đấy nó kết hợp lại",
    grammar: "PHOTO_EVIDENCE", emotion: "sarcastic",
    purpose: "The market starts feeling like a social feed.",
    viewerFocus: "market as social media",
    slots: { photo: "backgrounds/trading_workstation.jpg", caption: "Thị trường giờ giống mạng xã hội hơn" } },

  { marker: "Ai cũng nhìn bảng giá, cập nhật thông tin",
    grammar: "DIALOGUE_QA", emotion: "neutral",
    purpose: "Crowd reaction feeds more trading, in a loop.",
    viewerFocus: "crowd-following trading loop",
    slots: { asker: "hostPoint", answerer: "investor", askerText: "Sao ai cũng nhìn bảng giá?", answererText: "Vì ai cũng thấy người khác giao dịch.", stage: "assets/scenes/office_desk.svg", anchorA: "desk", anchorB: "desk_right" } },

  { marker: "Tức là toàn bộ hệ thống đã làm cho cái việc đầu tư",
    grammar: "VISUAL_METAPHOR", emotion: "concern",
    purpose: "Frictionless trading = frictionless bad decisions.",
    viewerFocus: "buying like tapping 'like'",
    slots: { setup: "Đặt lệnh mua = bấm nút like", payoff: "Quyết định dở hơi cũng tăng theo", leftAsset: "finance/investment", rightAsset: "finance/loss" } },

  { marker: "Và bốn yếu tố này khi ghép lại với nhau",
    grammar: "CHAR_PROP", emotion: "neutral",
    purpose: "Recap the four combined root causes.",
    viewerFocus: "the four factors combined",
    slots: { who: "hostPlain", prop: "props/concept_card", label: "Bốn yếu tố khóa vào nhau" } },

  { marker: "Một bên là áp lực kiếm tiền nhanh này",
    grammar: "DIALOGUE_QA", emotion: "concern",
    purpose: "Pressure to get rich fast vs. feeling of an unfair system.",
    viewerFocus: "pressure vs. perceived unfairness",
    slots: { asker: "hostShrug", answerer: "studentSchool", askerText: "Vì sao phải kiếm tiền nhanh?", answererText: "Tôi thấy luật chơi không công bằng.", stage: "assets/scenes/living_room.svg", anchorA: "sofa_left", anchorB: "sofa_right" } },

  { marker: "Và khi mà ba thứ đấy xuất hiện cùng một lúc",
    grammar: "EVIDENCE", emotion: "neutral",
    purpose: "Introduce the concrete 2023 CFD scandal example.",
    viewerFocus: "the CFD scandal case study",
    slots: { title: "Vụ bê bối CFD, năm 2023", body: "Một ví dụ điển hình của sản phẩm đòn bẩy rủi ro cao đáp ứng nhu cầu này" } },

  { marker: "CFD là viết tắt của Contracts for difference",
    grammar: "FRAMEBOX", emotion: "neutral",
    purpose: "Define CFD plainly.",
    viewerFocus: "what a CFD is", slots: { content: "#3B5998", caption: "CFD: cược giá, không sở hữu", who: "investor" } },

  { marker: "Và giống như rất là nhiều sản phẩm đầu cơ khác",
    grammar: "STAT_REVEAL", emotion: "surprise",
    purpose: "CFDs come with very high leverage.",
    viewerFocus: "high leverage on CFDs",
    slots: { stat: "ĐÒN BẨY RẤT CAO", anchor: "finance/loss", who: "characters/cat_surprised", caption: "CFD thường đi kèm rủi ro rất lớn" } },

  { marker: "Theo cơ quan quản lý tài chính ở Hàn Quốc ấ thì phần lớn",
    grammar: "EVIDENCE", emotion: "concern",
    purpose: "Regulator finding: retail trades mislabeled as institutional.",
    viewerFocus: "mislabeled retail CFD trades",
    slots: { title: "Cơ quan quản lý tài chính Hàn Quốc", body: "Nhiều lệnh CFD của cá nhân bị ghi nhận nhầm dưới danh nghĩa tổ chức nước ngoài" } },

  { marker: "Và điều này khiến thị trường lại trở nên méo mó",
    grammar: "TABLEAU", emotion: "sarcastic",
    purpose: "No one can tell who's really holding the risk.",
    viewerFocus: "opaque, distorted market data",
    slots: { stage: "assets/scenes/office_desk.svg", who: "host", anchorA: "desk_right", prop: "props/thought_bubble", caption: "Dữ liệu méo mó, ai gánh rủi ro?" } },

  { marker: "Và khi mà vụ việc bị phanh phui",
    narrationOverride: "Khi vụ việc bị phanh phui, cơ quan quản lý phản ứng theo cách quen thuộc: xuất quy định mới, tăng yêu cầu ký quỹ, nâng chuẩn tham gia và tăng cường giám sát.",
    grammar: "POLICY_LIST", emotion: "neutral",
    purpose: "List the regulator's standard response measures.",
    viewerFocus: "the regulatory crackdown steps",
    slots: { items: "Quy định mới|Tăng yêu cầu ký quỹ|Nâng chuẩn tham gia|Tăng giám sát", icons: "props/book|finance/interest_rate|finance/investment|finance/loss" } },

  { marker: "Nhưng mà những cái đấy thì nó cũng chỉ là xử lý phần ngọn",
    grammar: "VISUAL_METAPHOR", emotion: "sarcastic",
    purpose: "Closing one door just opens another — regulation treats symptoms.",
    viewerFocus: "closing one door, opening another",
    slots: { setup: "Đóng một cánh cửa", payoff: "Người ta tìm cánh cửa khác", leftAsset: "finance/loss", rightAsset: "finance/investment" } },

  { marker: "Và khi mà CFD bị xết chặt thì tiền chảy sang",
    narrationOverride: "Khi CFD bị siết chặt, tiền chảy sang những sản phẩm đòn bẩy khác — một phần sang thị trường nước ngoài, một phần sang những công cụ phức tạp và khó giám sát hơn.",
    grammar: "CHAR_PROP", emotion: "concern",
    purpose: "Capital flows to riskier, less-regulated channels.",
    viewerFocus: "capital flowing to unregulated channels",
    slots: { who: "skeptic", prop: "finance/exchange", label: "CFD bị siết, tiền đổi sang kênh khác" } },

  { marker: "Đến cuối năm 2024 thì lượng cổ phiếu nước ngoài",
    grammar: "STAT_REVEAL", emotion: "surprise",
    purpose: "Retail capital flowing into foreign stocks at scale.",
    viewerFocus: "foreign-held stock scale",
    slots: { stat: "QUY MÔ RẤT LỚN", anchor: "finance/exchange", who: "characters/cat_surprised", caption: "Cổ phiếu nước ngoài, cuối 2024" } },

  { marker: "Trong đó thì ngày càng xuất hiện nhiều sản phẩm",
    grammar: "PHOTO_EVIDENCE", emotion: "concern",
    purpose: "People chase leverage products banned at home, abroad.",
    viewerFocus: "seeking banned leverage abroad",
    slots: { photo: "backgrounds/airport.jpg", caption: "Né kiểm soát bằng cách ra nước ngoài" } },

  { marker: "Tức là khi mà không được chơi xong sân nhà",
    narrationOverride: "Không được chơi ở sân nhà thì người ta đi tìm sân khác. Đây cũng là lý do nhiều chuyên gia ví đầu cơ giống như dòng nước chảy.",
    grammar: "VISUAL_METAPHOR", emotion: "neutral",
    purpose: "The water-flow metaphor for speculation finding new paths.",
    viewerFocus: "speculation as flowing water",
    slots: { setup: "Ngăn một dòng nước", payoff: "Nước tự tìm đường khác để chảy", leftAsset: "finance/loss", rightAsset: "finance/exchange" } },

  { marker: "Bạn có thể ngăn chặn một dọc nước",
    grammar: "TABLEAU", emotion: "sarcastic",
    purpose: "The harder you block it, the more it finds hidden gaps.",
    viewerFocus: "blocking harder just redirects the flow",
    slots: { stage: "assets/scenes/bank_interior.svg", who: "regulator", anchorA: "counter_right", prop: "finance/exchange", caption: "Càng chặn, càng luồn qua khe hẹp" } },

  { marker: "và đôi khi nó sẽ chảy tới những cái nơi mà khó kiểm soát hơn",
    grammar: "PHOTO_EVIDENCE", emotion: "sad",
    purpose: "Banning one product doesn't kill speculative demand.",
    viewerFocus: "demand just shifts form",
    slots: { photo: "backgrounds/korea_apartments.jpg", caption: "Cấm 1 sản phẩm không diệt nhu cầu đầu cơ" } },

  { marker: "thường là xa hơn, phức tạp hơn và khó nhìn thấy hơn",
    grammar: "CHAR_PROP", emotion: "concern",
    purpose: "Where displaced speculation tends to end up.",
    viewerFocus: "farther, more complex, harder to see",
    slots: { who: "hostHappy", prop: "finance/exchange", label: "Xa hơn, phức tạp hơn, khó thấy hơn" } },

  { marker: "Nhưng mà tất cả những gì mà chúng ta vừa nói ở trên",
    grammar: "PHOTO_EVIDENCE", emotion: "neutral",
    purpose: "Empathy pivot: this isn't about Korean greed.",
    viewerFocus: "reframing away from greed",
    slots: { photo: "backgrounds/finance_desk.jpg", caption: "Không phải vì tham lam" } },

  { marker: "Tại vì là khi mà cả một hệ thống",
    grammar: "PHOTO_EVIDENCE", emotion: "concern",
    purpose: "Systemic pressure makes 'irrational' choices understandable.",
    viewerFocus: "system pressure explaining choices",
    slots: { photo: "backgrounds/home_study.jpg", caption: "Người ngoài thấy vô lý, trong cuộc thấy dễ hiểu" } },

  { marker: "Bây giờ bạn là một người Hàn Quốc khoảng 28 tuổi",
    narrationOverride: "Bây giờ, giả sử bạn là một người Hàn Quốc khoảng 28 tuổi, công việc không ổn định, hợp đồng ký lại mỗi năm, chẳng biết tương lai ra sao.",
    grammar: "TABLEAU", emotion: "sad",
    purpose: "Second-person persona scene: the precarious 28-year-old.",
    viewerFocus: "a young worker with an unstable job",
    slots: { stage: "assets/scenes/office_desk.svg", who: "youngperson", anchorA: "desk", prop: "props/calendar", caption: "28 tuổi, tương lai mờ mịt" } },

  { marker: "Trong khi đấy thì chả biết là bao giờ mới mua được nhà",
    narrationOverride: "Trong khi đó, chẳng biết bao giờ mới mua được nhà vì giá nhà cứ tăng vọt, còn mỗi ngày mở điện thoại lại thấy thị trường tăng, người ta khoe lợi nhuận suốt.",
    grammar: "CHAR_PROP", emotion: "sad",
    purpose: "Rising home prices vs. endless online profit-flexing.",
    viewerFocus: "house prices out of reach, feeds full of gains",
    slots: { who: "youngperson", prop: "finance/house", label: "Giá nhà tăng vọt, ai cũng khoe lợi nhuận" } },

  { marker: "ấy những câu chuyện đổi đời xuất hiện khắp nơi",
    grammar: "PHOTO_EVIDENCE", emotion: "sad",
    purpose: "Rags-to-riches stories everywhere make it hard to sit out.",
    viewerFocus: "impossible to stay on the sidelines",
    slots: { photo: "backgrounds/living_room.jpg", caption: "Rất khó để đứng ngoài cuộc chơi" } },

  { marker: "Cái đáng sợ nhất không phải là Marin",
    grammar: "QA_REVEAL", emotion: "concern",
    purpose: "The video's thesis sentence.",
    viewerFocus: "the real thing to fear",
    slots: { q: "Cái đáng sợ nhất là gì?", a: "Không phải margin — mà là LÝ DO khiến người ta tìm đến nó", who: "analyst" } },

  { marker: "Nếu một thế hệ lớn lên với cảm giác rằng là làm việc chăm chỉ",
    grammar: "CHAR_PROP", emotion: "sad",
    purpose: "Three beliefs that define this generation's disillusionment.",
    viewerFocus: "hard work not paying off",
    slots: { who: "youngperson", prop: "finance/house", label: "Chăm chỉ, tiết kiệm vẫn chưa đủ" } },

  { marker: "thì cái việc họ bắt đầu tìm kiếm những lựa chọn rủi ro hơn",
    grammar: "PHOTO_EVIDENCE", emotion: "sad",
    purpose: "Reframe risk-taking as helplessness, not greed.",
    viewerFocus: "helplessness, not greed",
    slots: { photo: "backgrounds/city_street.jpg", caption: "Không phải tham lam, là bất lực và sợ tụt lại" } },

  { marker: "Và điều chớ trêu nhá lại thị trường",
    narrationOverride: "Và điều trớ trêu là thị trường lại thường thưởng cho những suy nghĩ đó — trong ngắn hạn.",
    grammar: "TABLEAU", emotion: "sarcastic",
    purpose: "The market rewards this risk-taking, temporarily.",
    viewerFocus: "short-term rewards reinforcing risk",
    slots: { stage: "assets/scenes/bar.svg", who: "host", anchorA: "counter_left", prop: "finance/profit", caption: "Thị trường thưởng cho liều lĩnh, tạm thời" } },

  { marker: "Mỗi lần mà thị trường giảm xong bật tăng trở lại",
    narrationOverride: "Mỗi lần thị trường giảm rồi bật tăng trở lại, người dùng đòn bẩy lại cảm thấy: 'À, mình đúng rồi! Mình đầu tư giỏi thật, nhìn tài khoản lợi nhuận một đống đây này.'",
    grammar: "DIALOGUE_QA", emotion: "hopeful",
    purpose: "Dramatize the false confidence after a rebound.",
    viewerFocus: "traders bragging after a rebound",
    slots: { asker: "plainInvestor", askerText: "Mình đầu tư giỏi thật đấy chứ!", answerer: "skeptic", answererText: "Lợi nhuận một đống luôn!" } },

  { marker: "xong mà lại nghĩ là mẹ phát sau",
    narrationOverride: "Rồi lại nghĩ: 'Lần sau phải làm mạnh hơn nữa.' Và đây là một điểm chí mạng của thị trường — nó khiến người ta nhầm lẫn giữa may mắn và năng lực.",
    grammar: "TABLEAU", emotion: "sarcastic",
    purpose: "Name the luck-vs-skill confusion trap.",
    viewerFocus: "confusing luck with skill",
    slots: { stage: "assets/scenes/office_desk.svg", who: "host", anchorA: "desk_right", prop: "props/trophy", caption: "Nhầm lẫn giữa may mắn và năng lực" } },

  { marker: "Thắng một phát không nghĩa là bạn là thiên tài chứng khoán",
    grammar: "DIALOGUE_QA", emotion: "sarcastic",
    purpose: "A single win means good timing, not genius.",
    viewerFocus: "genius illusion vs. lucky timing",
    slots: { asker: "host", answerer: "investor", askerText: "Một lần thắng là thiên tài?", answererText: "Có khi chỉ đúng chỗ, đúng lúc." } },

  { marker: "Một hai lần ăn có thể ngon đấy",
    grammar: "STAT_REVEAL", emotion: "sad",
    purpose: "Debt and interest keep running regardless of a few wins.",
    viewerFocus: "debt and interest still running",
    slots: { stat: "LÃI VẪN CHẠY", anchor: "finance/debt", who: "characters/cat_sad", caption: "Thắng hay thua, lãi vay vẫn chạy" } },

  { marker: "Về mặt cốt lõi thì đây vẫn là một trong những hệ quả",
    grammar: "PHOTO_EVIDENCE", emotion: "neutral",
    purpose: "Restate the root cause: assets outpacing income.",
    viewerFocus: "the underlying structural cause",
    slots: { photo: "backgrounds/stock_chart.jpg", caption: "Cốt lõi: tài sản tăng nhanh hơn thu nhập" } },

  { marker: "Nợ tăng dần qua từng năm này, giá tài sản tăng nhanh hơn thu nhập",
    grammar: "CHAR_PROP", emotion: "concern",
    purpose: "Recap the three structural forces feeding the cycle.",
    viewerFocus: "rising debt, cheap money, risk-seeking capital",
    slots: { who: "youngperson", prop: "finance/debt", label: "Nợ tăng, tiền rẻ, vốn tìm rủi ro" } },

  { marker: "Và trong suốt quá trình đó rất nhiều người tin rằng",
    grammar: "PHOTO_EVIDENCE", emotion: "concern",
    purpose: "The universal belief 'I'll get out in time'.",
    viewerFocus: "the belief you'll exit in time",
    slots: { photo: "backgrounds/market_monitor.jpg", caption: "\"Mình sẽ kịp thoát trước khi tồi tệ\"" } },

  { marker: "Và đó cũng là suy nghĩ xuất hiện trong hầu hết những cơn sốt",
    grammar: "HISTORY_TIMELINE", emotion: "concern",
    purpose: "This belief recurs across history's speculative manias.",
    viewerFocus: "the recurring pattern across speculative bubbles",
    slots: { items: "Niềm tin \"mình sẽ kịp thoát\"|Xuất hiện ở mọi cơn sốt đầu cơ|Chính là thứ khiến mọi thứ sụp đổ", icons: "characters/cat_think|finance/chart_up|finance/loss" } },

  { marker: "Thế thì bao giờ người Hàn Quốc mới nhận ra",
    grammar: "QA_REVEAL", emotion: "curious",
    purpose: "Pivot to the present/future outlook.",
    viewerFocus: "when will people stop",
    slots: { q: "Bao giờ họ mới dừng lại?", a: "Có lẽ họ biết rồi — nhưng vẫn chưa dừng", who: "regulator" } },

  { marker: "Bớt sang năm 2026 thì thị trường Hàn Quốc",
    narrationOverride: "Bước sang năm 2026, thị trường Hàn Quốc vẫn tiếp tục biến động rất mạnh. Một bên là nhà đầu tư nước ngoài liên tục rút vốn, bên còn lại là nhà đầu tư cá nhân vẫn kiên trì mua vào.",
    grammar: "DIALOGUE_QA", emotion: "neutral",
    purpose: "Present-day split: foreign outflows vs. retail buying the dip.",
    viewerFocus: "foreign selling vs. retail buying",
    slots: { asker: "broker", answerer: "investor", askerText: "Khối ngoại đang rút vốn.", answererText: "Nhà đầu tư lẻ vẫn mua đáy.", stage: "assets/scenes/boardroom.svg", anchorA: "seat_left", anchorB: "seat_right" } },

  { marker: "Về quan điểm đầu tư thì mỗi người lại nghĩ một kiểu",
    grammar: "PHOTO_EVIDENCE", emotion: "neutral",
    purpose: "Views on where the market goes next diverge widely.",
    viewerFocus: "diverging market opinions",
    slots: { photo: "backgrounds/stock_board.jpg", caption: "Mỗi người một niềm tin khác nhau" } },

  { marker: "Thậm chí là có những người vẫn tiếp tục vay tiền để đầu tư",
    grammar: "TABLEAU", emotion: "concern",
    purpose: "Some are still borrowing, betting on the next rebound.",
    viewerFocus: "still borrowing, still betting",
    slots: { stage: "assets/scenes/living_room.svg", who: "skeptic", anchorA: "sofa_right", prop: "finance/loan", caption: "\"Biết đâu lần này mình đúng?\"" } },

  { marker: "Tất nhiên là kịch bản lạc quan thì vẫn hoàn toàn có thể xảy ra",
    grammar: "CHAR_PROP", emotion: "hopeful", heroVisual: true,
    purpose: "The hopeful, balanced note — Korea's real long-term upside.",
    viewerFocus: "semiconductors and AI as genuine strengths",
    slots: { who: "host", prop: "props/brain", label: "Doanh nghiệp mạnh, chip và AI" } },

  { marker: "Nếu mà mọi thứ diễn ra thuận lợi thì thị trường hoàn toàn có thể",
    grammar: "DIALOGUE_QA", emotion: "neutral",
    purpose: "Balance the upside case against the ever-present risk.",
    viewerFocus: "upside potential vs. lingering risk",
    slots: { asker: "host", answerer: "investor", askerText: "Triển vọng dài hạn tốt chứ?", answererText: "Có cơ hội, nhưng rủi ro vẫn còn." } },

  { marker: "Đoàn bảy hiện nặng ở mức rất là cao",
    grammar: "STAT_REVEAL", emotion: "concern",
    purpose: "Restate the risk baseline: leverage and debt still high.",
    viewerFocus: "leverage and debt still elevated",
    slots: { stat: "MARGIN VẪN Ở MỨC CAO", anchor: "finance/debt", who: "characters/cat_sad", caption: "Nợ cao, kinh tế phục hồi chậm" } },

  { marker: "Và khi mà một hệ thống đã chất đầy đoàn bảy",
    grammar: "PHOTO_EVIDENCE", emotion: "concern",
    purpose: "A leverage-loaded system is sensitive to any shock.",
    viewerFocus: "sensitivity to shocks",
    slots: { photo: "backgrounds/office_trading.jpg", caption: "Hệ thống đầy margin, nhạy cảm mọi cú sốc" } },

  { marker: "Có thể là xốc về lãi suất toàn cầu này",
    narrationOverride: "Có thể là một cú sốc lãi suất toàn cầu, có thể là biến động địa chính trị, có thể là một cú sốc bất ngờ trong ngành chip, hoặc đơn giản là tâm lý thị trường đổi chiều.",
    grammar: "CHAR_PROP", emotion: "concern",
    purpose: "List the possible shock triggers.",
    viewerFocus: "possible shock triggers",
    slots: { who: "regulator", prop: "finance/loss", label: "Lãi suất, địa chính trị, ngành chip" } },

  { marker: "Có đấy là cái điều đáng quan sát nhất",
    narrationOverride: "Điều đáng quan sát nhất trong những năm tới là: liệu Hàn Quốc có tìm được cách giúp người trẻ xây dựng tài sản, mà không phải đánh cược ngày càng lớn hay không?",
    grammar: "QA_REVEAL", emotion: "curious", heroVisual: true,
    purpose: "Closing outlook question — the video's final open thought.",
    viewerFocus: "the closing question",
    slots: { who: "hostHappy", q: "Liệu có cách nào xây dựng tài sản khác?", a: "Không cần đánh cược ngày càng lớn?" } },

  { marker: "Cảm ơn các bạn đã theo dõi",
    grammar: "TABLEAU", emotion: "happy",
    purpose: "Standard channel sign-off and subscribe CTA.",
    viewerFocus: "the sign-off",
    slots: { stage: "assets/scenes/library.svg", who: "host", anchorA: "table", prop: "props/book", caption: "Cảm ơn đã xem! Đăng ký nhé!" } },
];

type Direction = Pick<AuthoredScene,
  "visualRegister" | "focalType" | "semanticVisual" |
  "silentFrameTakeaway" | "focalOccupancyTarget" | "characterRequired"
>;

/**
 * Explicit one-to-one directing decisions for BASE_SCENES. This helper only
 * duplicates the authored takeaway into the muted-view field; it does not
 * infer intent from grammar, keywords, or scene index.
 */
function direct(
  visualRegister: VisualRegister,
  focalType: FocalType,
  subject: string,
  action: string,
  takeaway: string,
  focalOccupancyTarget: number,
  characterRequired: boolean,
  details: Partial<Pick<SemanticVisual, "object" | "relation" | "setting">> = {},
): Direction {
  return {
    visualRegister,
    focalType,
    semanticVisual: { subject, action, takeaway, ...details },
    silentFrameTakeaway: takeaway,
    focalOccupancyTarget,
    characterRequired,
  };
}

const DIRECTIONS: Direction[] = [
  // 001–010: hook and margin mechanics
  direct("full_tableau", "full_scene", "host on a Korean city street", "turns from pop-culture signs toward a red margin warning", "Korea's familiar image hides a leveraged-investing problem", 0.42, true, { object: "margin warning", setting: "city street" }),
  direct("visual_gag", "visual_gag", "host and stock prop", "connect stocks, crypto and housing to borrowed-money acceleration", "several asset booms share the same leverage accelerant", 0.48, true, { object: "stock prop" }),
  direct("evidence", "chart", "KOSPI loss figure", "drops beside a falling-market icon", "KOSPI lost 18 percent in only a few days", 0.50, false, { object: "KOSPI decline" }),
  direct("evidence", "evidence", "broker lending notice", "shows the margin ceiling being reached", "brokers had to halt loans because margin capacity was full", 0.55, false, { object: "margin lending limit" }),
  direct("full_tableau", "full_scene", "host at an office desk", "questions why leverage became normal in a mature market", "the puzzle is not only the crash but why Korea embraced margin", 0.40, true, { setting: "office finance" }),
  direct("character_action", "character_action", "thinking host", "poses the two central questions before revealing the answer", "the story asks why people borrow to speculate and why margin spread", 0.40, true, { object: "two central questions" }),
  direct("full_tableau", "full_scene", "host in a library", "introduces the leverage story", "this is a guided explanation of Korea's leverage boom", 0.40, true, { setting: "library school" }),
  direct("full_tableau", "full_scene", "host at a library table", "opens the margin lesson", "understanding margin comes before judging its users", 0.40, true, { object: "margin lesson", setting: "library school" }),
  direct("character_action", "character_action", "host", "points at a loan feeding a stock purchase", "margin means borrowing from a broker to buy more stock", 0.46, true, { object: "broker loan" }),
  direct("character_action", "character_action", "host and investor", "act out buying power expanding from 100 million to 200 million", "a loan doubles buying power before any return occurs", 0.48, true, { relation: "host questions leveraged investor" }),

  // 011–020: upside, downside and debt
  direct("evidence", "chart", "profit figure", "lands above an upward chart and measure label", "a 10 percent stock gain becomes 20 million on doubled exposure", 0.48, false, { object: "leveraged profit" }),
  direct("infographic", "chart", "loss multiplier", "falls while the debt remains fixed", "margin doubles losses but never erases principal or interest", 0.48, false, { relation: "falling asset value versus fixed debt" }),
  direct("visual_gag", "visual_gag", "race engine and investment portfolio", "accelerate together before flying off a sharp bend", "leverage is exhilarating until a small turn becomes a crash", 0.52, true, { relation: "race engine represents leverage" }),
  direct("framebox", "screenshot", "margin-call warning", "fills a monitor like an unavoidable alert", "margin call is the mechanism that makes leverage lethal", 0.52, false, { object: "margin call alert" }),
  direct("character_action", "character_action", "broker and investor", "act out the cash demand and forced sale", "below the safety line the broker can liquidate the shares", 0.50, true, { relation: "broker liquidates investor shares" }),
  direct("character_action", "character_action", "broker and investor", "exchange a demand for cash and an admission of shortage", "many simultaneous margin calls create forced selling", 0.48, true, { relation: "broker demands cash from indebted investor" }),
  direct("visual_gag", "visual_gag", "falling investor", "knocks a line of investors down a staircase", "one margin call can cascade into market-wide selling", 0.50, true, { relation: "first fall triggers the crowd" }),
  direct("photo_broll", "photo", "empty trading workspace and market screens", "show the aftermath without a presenter", "the selloff exposed a deeper generational pattern", 0.78, false, { setting: "office trading finance" }),
  direct("evidence", "chart", "household-debt ratio", "presses against a GDP marker", "Korean household debt is nearly as large as annual output", 0.50, false, { object: "household debt versus GDP" }),
  direct("infographic", "chart", "1,900 trillion won debt figure", "fills the frame beside a debt weight", "household credit exceeded 1,900 trillion won by late 2025", 0.52, false, { object: "household credit total" }),

  // 021–030: housing and young workers
  direct("photo_broll", "photo", "apartment towers without visible people", "tie household debt to housing", "housing is the main pressure behind the debt story", 0.76, false, { setting: "home city apartment" }),
  direct("full_tableau", "full_scene", "tenant and landlord", "face each other across a housing deposit", "jeonse asks the tenant for a huge deposit instead of monthly rent", 0.48, true, { object: "jeonse deposit", relation: "tenant pays landlord", setting: "home living" }),
  direct("evidence", "chart", "jeonse deposit ratio", "covers half of a house silhouette", "a jeonse deposit can reach half the home's value", 0.50, false, { object: "house value" }),
  direct("full_tableau", "full_scene", "young tenant at a bank counter", "stares at an unaffordable deposit", "jeonse's first barrier is finding a very large lump sum", 0.45, true, { object: "large deposit", setting: "finance bank" }),
  direct("character_action", "character_action", "landlord and tenant", "share the benefit of cheap financing", "the jeonse system appears stable when interest rates stay low", 0.46, true, { relation: "low rates support both sides", setting: "home living" }),
  direct("character_action", "character_action", "tenant and landlord", "confront the repayment shortfall after rates rise", "higher rates can break the jeonse repayment chain", 0.50, true, { relation: "tenant asks landlord for deposit" }),
  direct("evidence", "chart", "youth employment weakness", "shrinks beside a precarious worker", "weak youth employment adds another barrier to asset building", 0.48, false, { object: "young worker prospects" }),
  direct("character_action", "character_action", "young worker", "juggles short contracts, part-time shifts and unstable income", "precarious work makes long-term saving difficult", 0.48, true, { object: "three insecure job conditions" }),
  direct("photo_broll", "photo", "empty apartment corridor", "separates the younger generation from ownership", "many young Koreans feel permanently behind their parents", 0.74, false, { setting: "home apartment" }),
  direct("character_action", "character_action", "parent and young worker", "stand on opposite sides of a widening asset gap", "parents bought assets more easily while today's youth cannot catch up", 0.50, true, { relation: "generational wealth contrast" }),

  // 031–040: asset pressure and retail dominance
  direct("full_tableau", "full_scene", "young worker on a city street", "turns from a pay slip toward the stock market", "markets begin to look like the only remaining ladder", 0.46, true, { object: "stock market as ladder", setting: "city street" }),
  direct("character_action", "character_action", "young worker and stock prop", "show wages falling behind asset prices", "when wages lag assets, investment feels compulsory", 0.50, true, { object: "stock shortcut" }),
  direct("visual_gag", "visual_gag", "young investor", "grips a faster vehicle marked margin", "margin promises speed but magnifies every accident", 0.48, true, { object: "leveraged vehicle" }),
  direct("photo_broll", "photo", "distant city skyline", "visualizes people watching wealth move away", "being left behind is the emotion driving risk-taking", 0.75, false, { setting: "city urban" }),
  direct("character_action", "character_action", "asset owner and wage earner", "move at visibly different speeds", "assets enrich owners while non-owners remain still", 0.50, true, { relation: "owner advances while worker stalls" }),
  direct("full_tableau", "full_scene", "a group of young workers", "gather around the same market idea", "a shared feeling can reshape a generation's choices", 0.48, true, { relation: "peers influence one another", setting: "city street" }),
  direct("visual_gag", "visual_gag", "young worker and hourglass", "show time and living costs chasing the worker", "education, hype and pressure funnel people into markets", 0.50, true, { object: "hourglass pressure" }),
  direct("full_tableau", "full_scene", "worker on a city street", "runs after a receding home and portfolio", "not running appears to make the wealth gap wider", 0.46, true, { object: "receding assets", setting: "city street" }),
  direct("character_action", "character_action", "host", "turns a page from household pressure to market structure", "personal pressure is only half the explanation", 0.42, true, { object: "market-structure chapter" }),
  direct("evidence", "chart", "retail participation figure", "dominates a market-volume chart", "Korea's stock market is unusually retail-driven", 0.50, false, { object: "retail trading share" }),

  // 041–050: gaemi behaviour
  direct("character_action", "character_action", "institutional desk and retail trader", "occupy opposite sides of the market", "developed markets are institution-led while Korea is retail-heavy", 0.50, true, { relation: "institutional versus retail participation" }),
  direct("evidence", "chart", "two-thirds figure", "fills a 2020 trading-volume card", "retail investors generated about two-thirds of trading volume in 2020", 0.52, false, { object: "2020 retail volume" }),
  direct("infographic", "chart", "60 percent figure", "holds above an order-flow icon", "retail orders still approached 60 percent in 2026", 0.50, false, { object: "2026 retail order share" }),
  direct("character_action", "character_action", "excited retail crowd", "rushes money into a rising market", "retail enthusiasm accelerates inflows", 0.48, true, { relation: "euphoria causes rapid buying" }),
  direct("character_action", "character_action", "host and panicked investor", "act out a rapid crowd-driven sell decision", "the same crowd can accelerate a selloff", 0.50, true, { relation: "host warns investor during panic" }),
  direct("full_tableau", "full_scene", "gaemi investor", "stands among many ant-like traders on the street", "Korean retail investors call themselves ants", 0.50, true, { relation: "one gaemi belongs to a crowd", setting: "city street" }),
  direct("visual_gag", "visual_gag", "one ant investor", "becomes a million ants moving together", "small investors become a market force when they move as a crowd", 0.52, true, { relation: "individual scales into crowd" }),
  direct("full_tableau", "full_scene", "gaemi crowd in a park", "carries visible debt weights together", "borrowed money makes the retail crowd more dangerous", 0.50, true, { object: "margin debt", setting: "park" }),
  direct("evidence", "evidence", "behavioural research card", "lists documented retail-investor mistakes", "research finds recurring mistakes in Korean retail trading", 0.56, false, { object: "behavioural findings" }),
  direct("framebox", "screenshot", "FOMO message", "appears in a phone-like frame", "seeing others buy creates pressure to follow", 0.55, false, { relation: "social proof drives buying" }),

  // 051–060: biases of leveraged traders
  direct("visual_gag", "visual_gag", "retail trader and lottery-like stock", "chases a tiny risky ticker as if it were a jackpot", "small speculative stocks can feel like lottery tickets", 0.50, true, { relation: "stock chase mirrors gambling" }),
  direct("character_action", "character_action", "retail trader", "sells a small winner but hugs a large loser", "investors often sell winners early and hold losers too long", 0.50, true, { relation: "opposite treatment of gains and losses" }),
  direct("full_tableau", "full_scene", "host in a classroom", "labels the disposition effect on a board", "the bias is famous worldwide, not uniquely Korean", 0.46, true, { object: "disposition effect", setting: "school classroom" }),
  direct("photo_broll", "photo", "market monitor showing leveraged volatility", "fills the frame without a presenter", "margin makes an ordinary bias more extreme", 0.78, false, { object: "borrowed exposure", setting: "market monitor" }),
  direct("evidence", "evidence", "KCMI study card", "shows margin users trading more aggressively", "KCMI research identifies outsized activity among margin users", 0.56, false, { object: "KCMI margin research" }),
  direct("character_action", "character_action", "margin trader", "rapidly switches among frequent trades, risky stocks and large positions", "margin users trade more often, riskier and bigger", 0.50, true, { object: "three aggressive behaviours" }),
  direct("visual_gag", "visual_gag", "driver-like investor", "presses the accelerator while carrying a debt tank", "the most aggressive traders are powered by borrowed money", 0.48, true, { object: "debt accelerator" }),
  direct("character_action", "character_action", "leveraged trader", "celebrates first in a boom and falls first in a crash", "leverage leads both gains and losses", 0.52, true, { relation: "boom reward versus crash damage" }),
  direct("evidence", "chart", "net-return figure", "settles near zero after fees and interest", "extra risk does not guarantee better net returns", 0.50, false, { object: "return after costs" }),
  direct("photo_broll", "photo", "empty finance desk after trading", "leaves risk and stress visible without a presenter", "margin users accept more risk without reliably outperforming", 0.76, false, { setting: "office finance" }),

  // 061–070: four root causes and Korea Discount
  direct("character_action", "character_action", "host", "asks why investors still accept this bargain", "the next section seeks the structural reasons", 0.42, true, { object: "root-cause question" }),
  direct("character_action", "character_action", "host and concept card", "introduce four root causes of the leverage problem", "asset pressure, market structure, distrust and easy access combine", 0.52, true, { object: "four-root concept card" }),
  direct("full_tableau", "full_scene", "young worker at a trading desk", "treats stocks as the last ladder across the wealth gap", "markets feel like one of few remaining routes upward", 0.48, true, { object: "wealth ladder", setting: "office finance" }),
  direct("visual_gag", "visual_gag", "young investor", "opens a trading account from a phone beside a small cash pile", "entry now requires little more than a phone and an account", 0.48, true, { object: "mobile trading access" }),
  direct("photo_broll", "photo", "night city and finance screen", "frame the market as a distant last chance", "many young people see investing as their final realistic opportunity", 0.76, false, { setting: "city urban" }),
  direct("character_action", "character_action", "young investor", "holds a large opportunity in one paw and larger risk in the other", "margin enlarges opportunity and danger together", 0.50, true, { relation: "opportunity versus risk" }),
  direct("framebox", "screenshot", "Korea Discount title", "appears as a market explainer card", "the second root is the belief that Korean shares are undervalued", 0.55, false, { object: "Korea Discount concept" }),
  direct("character_action", "character_action", "Korean company and foreign peer", "stand under unequal valuation tags", "similar Korean companies often trade at lower valuations", 0.50, true, { relation: "domestic company discounted versus foreign peer" }),
  direct("infographic", "diagram", "governance and shareholder-return problems", "feed the Korea Discount", "ownership structure and weak payouts help create the discount", 0.52, false, { relation: "two causes produce lower valuation" }),
  direct("full_tableau", "full_scene", "short-term trader at a finance desk", "trades the discount instead of waiting for reform", "belief in undervaluation can encourage short-term speculation", 0.48, true, { object: "discount trade", setting: "office finance" }),

  // 071–080: distrust and frictionless access
  direct("full_tableau", "full_scene", "host and retail investor", "turn toward a short-selling board", "short selling is the third source of distrust", 0.46, true, { object: "short selling", setting: "office boardroom" }),
  direct("evidence", "evidence", "short-selling explainer", "shows its legitimate market role", "in theory short selling can improve price discovery", 0.56, false, { object: "short-selling function" }),
  direct("character_action", "character_action", "retail investor and institution", "face a visibly tilted playing field", "many retail investors believe institutions receive unfair advantages", 0.52, true, { relation: "retail versus institution fairness" }),
  direct("full_tableau", "full_scene", "retail crowd outside a courtroom", "reacts to short-selling scandals", "scandals deepen suspicion that the market is unfair", 0.48, true, { object: "short-selling scandal", setting: "public court" }),
  direct("visual_gag", "visual_gag", "investor and loss prop", "turn from broken trust toward quick profit", "low trust encourages short-term profit grabbing", 0.50, true, { object: "loss of trust" }),
  direct("photo_broll", "photo", "phone and finance desk without a visible person", "show how little friction remains", "the fourth root is effortless access to trading", 0.76, false, { setting: "office finance" }),
  direct("full_tableau", "full_scene", "old-style broker and client", "complete a stock order through a slow phone call", "trading once required a broker, time and high fees", 0.48, true, { relation: "client orders through broker", setting: "office finance" }),
  direct("character_action", "character_action", "modern mobile trader", "moves from waiting to instant execution", "a phone removes the old friction from every trade", 0.50, true, { relation: "old process versus instant mobile trade" }),
  direct("visual_gag", "visual_gag", "investor and computer desk", "react to videos, livestreams and forum hype", "financial hype now reaches investors everywhere", 0.52, true, { object: "online finance content" }),
  direct("character_action", "character_action", "two retail investors", "trade daily hype lines back and forth", "constant social chatter keeps pulling people into trades", 0.48, true, { relation: "peers amplify hype" }),

  // 081–090: social market and CFD scandal
  direct("photo_broll", "photo", "glowing market screen in an empty room", "resembles an always-on social feed", "the market starts to feel like a social platform", 0.78, false, { setting: "office finance" }),
  direct("character_action", "character_action", "host and investor", "act out checking prices because everyone else trades", "collective attention creates a self-reinforcing trading loop", 0.52, true, { relation: "peer attention reinforces trading" }),
  direct("visual_gag", "visual_gag", "mobile investor", "slides frictionlessly from one tap into a bad decision", "easy execution also makes mistakes easy", 0.50, true, { relation: "low friction accelerates error" }),
  direct("character_action", "character_action", "host and four-factor card", "lock the four root causes into one explanation", "four structural forces make leverage feel rational", 0.52, true, { object: "four-factor concept card" }),
  direct("character_action", "character_action", "young investor and tilted market", "stand between urgency and distrust", "pressure to get rich meets a belief that the system is unfair", 0.50, true, { relation: "urgency versus unfairness" }),
  direct("evidence", "evidence", "2023 CFD case file", "opens as the concrete example", "the CFD scandal shows what the combined forces can produce", 0.58, false, { object: "2023 CFD scandal" }),
  direct("framebox", "screenshot", "CFD definition", "shows a contract tracking price difference", "a CFD is a leveraged bet on price movement without owning the asset", 0.56, false, { object: "contract for difference" }),
  direct("infographic", "chart", "very-high leverage label", "towers over a CFD contract icon", "CFDs can carry exceptionally high leverage", 0.50, false, { object: "CFD leverage" }),
  direct("evidence", "evidence", "regulator finding", "reveals retail trades labeled institutional", "classification rules hid who was really taking the risk", 0.58, false, { object: "regulatory classification finding" }),
  direct("full_tableau", "full_scene", "regulator and market participants", "search for the real risk holder around a boardroom table", "opaque classification makes market risk hard to locate", 0.50, true, { relation: "regulator cannot identify true holder", setting: "office boardroom" }),

  // 091–100: regulation and displaced speculation
  direct("infographic", "diagram", "three regulatory measures", "close around the CFD channel", "regulators respond with restrictions, disclosure and supervision", 0.52, false, { relation: "measures constrain CFD activity" }),
  direct("visual_gag", "visual_gag", "speculation stream", "escapes through another door as one closes", "rules that treat symptoms can redirect rather than remove demand", 0.54, true, { relation: "closed door opens another route" }),
  direct("visual_gag", "visual_gag", "investor and exchange prop", "redirect money from restricted CFDs toward another channel", "tightening one product can push money into less regulated channels", 0.52, true, { object: "cross-border exchange" }),
  direct("evidence", "chart", "foreign-stock holdings figure", "rises on a cross-border flow card", "retail money moved into foreign stocks at large scale by late 2024", 0.52, false, { object: "foreign stock holdings" }),
  direct("photo_broll", "photo", "empty airport departure view", "signals capital leaving for overseas products", "investors can chase overseas products banned at home", 0.78, false, { object: "overseas leveraged product", setting: "travel airport" }),
  direct("visual_gag", "visual_gag", "water-like speculative demand", "flows around a barrier into a foreign channel", "speculation changes route when the home route closes", 0.54, false, { relation: "water represents displaced demand" }),
  direct("full_tableau", "full_scene", "host at a bank barrier", "points at hidden gaps around the restriction", "harder barriers create harder-to-see escape routes", 0.48, true, { relation: "barrier redirects flow", setting: "finance bank" }),
  direct("photo_broll", "photo", "distant airport concourse without faces", "suggests capital moving beyond domestic oversight", "displaced demand may end up where it is harder to control", 0.76, false, { setting: "travel airport" }),
  direct("visual_gag", "visual_gag", "host and exchange prop", "point toward a farther and less visible channel", "new channels tend to be farther away, more complex and less visible", 0.52, true, { object: "remote speculative channel" }),
  direct("photo_broll", "photo", "quiet residential skyline", "pauses the accusation and restores context", "this story is not proof that Koreans are uniquely greedy", 0.76, false, { setting: "city home" }),

  // 101–110: empathy and false confidence
  direct("photo_broll", "photo", "empty work-and-housing environment", "places risky choices inside systemic pressure", "apparently irrational choices can be understandable under pressure", 0.76, false, { setting: "office home" }),
  direct("full_tableau", "full_scene", "28-year-old contract worker", "sits with a short contract, work burden and small savings", "a precarious young worker has little room to build assets slowly", 0.50, true, { object: "contract and savings", setting: "office work" }),
  direct("character_action", "character_action", "young worker", "looks from an unreachable house toward online profit stories", "rising home prices and visible winners make waiting painful", 0.50, true, { relation: "house price versus profit feed" }),
  direct("photo_broll", "photo", "city lights and stock chart without people", "surround the viewer with apparent overnight success", "constant transformation stories make sitting out difficult", 0.78, false, { setting: "city urban" }),
  direct("character_action", "character_action", "concerned host", "reveals the thesis beneath the word margin", "the deepest danger is the belief that leverage is the only exit", 0.48, true, { object: "core thesis" }),
  direct("visual_gag", "visual_gag", "young worker and house prop", "show work and saving failing to reach housing", "a generation loses faith in work, saving and fair markets", 0.52, true, { object: "unreachable home" }),
  direct("photo_broll", "photo", "empty staircase toward distant housing", "reframes risk-taking as a search for agency", "greater risk can come from helplessness rather than greed", 0.76, false, { setting: "home city" }),
  direct("full_tableau", "full_scene", "leveraged investor at a bar counter", "receives a temporary reward from a market rebound", "markets sometimes reward dangerous behaviour long enough to teach it", 0.50, true, { object: "temporary rebound", setting: "bar" }),
  direct("character_action", "character_action", "two investors", "mistake a rebound for proof of skill", "a lucky recovery can create false confidence", 0.48, true, { relation: "peer validates rebound bet" }),
  direct("full_tableau", "full_scene", "trader at a market desk", "mistakes luck for repeatable expertise", "surviving one drop does not prove skill", 0.48, true, { object: "lucky rebound", setting: "office finance" }),

  // 111–120: history and the 2026 split
  direct("character_action", "character_action", "winning trader and timing clock", "separate one lucky win from durable skill", "one successful trade can be timing rather than genius", 0.50, true, { relation: "win versus skill" }),
  direct("evidence", "chart", "debt meter", "keeps ticking after two profitable bets", "a few wins do not stop interest and debt", 0.50, false, { object: "running debt cost" }),
  direct("photo_broll", "photo", "housing and income lines on an empty desk", "return the story to structural pressure", "the core problem is asset prices outrunning incomes", 0.76, false, { setting: "office home" }),
  direct("character_action", "character_action", "young worker and debt prop", "carry rising debt while income trails assets", "rising debt and assets alongside slower income feed the cycle", 0.52, true, { object: "debt burden" }),
  direct("photo_broll", "photo", "exit sign beside a market screen", "embodies the belief in escaping before everyone else", "many participants assume they will leave in time", 0.76, false, { setting: "office finance" }),
  direct("evidence", "diagram", "historic speculative manias", "repeat the same exit belief across time", "the promise of getting out in time recurs in every bubble", 0.56, false, { relation: "same belief repeats across history" }),
  direct("character_action", "character_action", "host", "asks when the leverage cycle will become obvious", "the outlook depends on when confidence breaks", 0.44, true, { object: "present outlook question" }),
  direct("character_action", "character_action", "foreign seller and retail buyer", "move in opposite directions across the 2026 market", "foreign outflows coexist with retail buying the dip", 0.52, true, { relation: "foreign selling versus retail buying" }),
  direct("photo_broll", "photo", "diverging stock-chart paths", "leave the future unresolved", "investors disagree sharply about what happens next", 0.76, false, { setting: "office finance" }),
  direct("full_tableau", "full_scene", "retail investor at home", "borrows again while betting on another rebound", "some investors are still financing the next recovery bet", 0.50, true, { object: "new margin loan", setting: "home living" }),

  // 121–127: balanced outlook and close
  direct("character_action", "character_action", "host and technology prop", "present companies, chips and AI as the optimistic case", "Korea still has credible long-term strengths", 0.52, true, { object: "technology opportunity" }),
  direct("character_action", "character_action", "hopeful investor and debt warning", "balance long-term opportunity against leverage risk", "upside is possible without making current leverage safe", 0.52, true, { relation: "opportunity versus risk" }),
  direct("evidence", "chart", "high leverage baseline", "remains elevated beside a debt icon", "leverage and household debt are still high", 0.50, false, { object: "leverage baseline" }),
  direct("photo_broll", "photo", "fragile trading system without people", "shows how a loaded structure reacts to a shock", "a leverage-heavy system is sensitive to small disturbances", 0.76, false, { setting: "office finance" }),
  direct("visual_gag", "visual_gag", "host and warning prop", "name rates, geopolitics and chips as possible shocks", "several different shocks could trigger the same fragile system", 0.52, true, { object: "shock warning" }),
  direct("character_action", "character_action", "thinking host", "holds open the final alternative to bigger bets", "the real test is whether young people can build assets without escalating wagers", 0.48, true, { object: "closing social question" }),
  direct("full_tableau", "full_scene", "host in the library", "closes the book and invites viewers back", "the explanation ends with a clear, warm sign-off", 0.42, true, { setting: "library school" }),
];

// Deliberately selected editorial anchors. This is an explicit marker list,
// not an index/modulo rule: every entry names the idea that earns a hero shot.
const HERO_SCENE_MARKERS = new Set([
  "Những cái thứ như là cổ phiếu",
  "Hậu quả bắt đầu lộ rõ",
  "Nhưng mà tại sao cái chuyện này",
  "Tại sao mà nhiều người",
  "Marin hay là giao dịch ký quỹ",
  "Nhưng mà vấn đề không phải là bạn cứ vay tiền",
  "Và cái thứ nguy hiểm nhất gọi là margin core",
  "Khi mà tài sản trong tài khoản giảm xuống dưới mức an toàn",
  "Và vấn đề nó thường nằm ở đây",
  "Và đó chính xác là những gì đã xảy ra",
  "Và cái điều đangng nói là phần lớn",
  "Nghe hợp lý mà có mà có một cái vấn đề",
  "nhưng mà khi lãi suất tăng ấy thì nhiều chủ nhà",
  "và nếu bạn là người trẻ thì câu chuyện",
  "Và điều này tạo ra một cảm giác khá là phổ biến",
  "Mua nhà ngày càng khó, tích lũy tài sản",
  "Nếu mà tiền lương mà tăng chậm hơn giá tài sản",
  "Còn Marin thì giống như kiểu là đưa cho bạn một cái xe máy",
  "Và khi mà cảm giác đó đã lan rộng ra cả một thế hệ",
  "Nhưng mà đó mới chỉ là một nửa câu chuyện",
  "Còn ở Hàn Quốc ấy thì trong nhiều năm",
  "Đây là một tỉ lệ rất là cao và nó kéo thêm",
  "Và khi mà họ hoảng loạn ấ thì lực bán",
  "Đặc biệt là khi phần lớn trong số đó",
  "Nhiều người lại thích săn những mã cổ phiếu nhỏ",
  "Đây là một cái hiện tượng rất là nổi tiếng trong tài chính hành vi",
  "Nhưng mà ở Hàn Quốc ấy thì mọi thứ lại cực đoan hơn",
  "Tại vì là đội này thì mua bán thường xuyên hơn",
  "Tức là đây là cái nhóm mà đạp ga mạnh nhất",
  "Và cái điều buồn cười là sau khi cộng tất cả",
  "Tức là họ chấp nhận nhiều rủi ro hơn, căng thẳng hơn",
  "Và chứng khoán là một trong những số ít nơi",
  "Đầu tiên là áp lực tài sản",
  "Và cũng như đã nói rất là nhiều rồi thì cơ hội lớn",
  "Nguyên nhân thì là một phần đến từ cấu trúc",
  "Về lý thuyết thì đây là một công cụ hoàn toàn bình thường",
  "Và khi mà niềm tin và tính công bằng của thị trường",
  "Còn bây giờ thì cứ điện thoại thôi",
  "Và khi mà tất cả những cái thứ đấy nó kết hợp lại",
  "Tức là toàn bộ hệ thống đã làm cho cái việc đầu tư",
  "Và bốn yếu tố này khi ghép lại với nhau",
  "Và khi mà ba thứ đấy xuất hiện cùng một lúc",
  "CFD là viết tắt của Contracts for difference",
  "Theo cơ quan quản lý tài chính ở Hàn Quốc ấ thì phần lớn",
  "Và điều này khiến thị trường lại trở nên méo mó",
  "Nhưng mà những cái đấy thì nó cũng chỉ là xử lý phần ngọn",
  "Và khi mà CFD bị xết chặt thì tiền chảy sang",
  "Tức là khi mà không được chơi xong sân nhà",
  "và đôi khi nó sẽ chảy tới những cái nơi mà khó kiểm soát hơn",
  "thường là xa hơn, phức tạp hơn và khó nhìn thấy hơn",
  "Bây giờ bạn là một người Hàn Quốc khoảng 28 tuổi",
  "Cái đáng sợ nhất không phải là Marin",
  "thì cái việc họ bắt đầu tìm kiếm những lựa chọn rủi ro hơn",
  "Và điều chớ trêu nhá lại thị trường",
  "Thắng một phát không nghĩa là bạn là thiên tài chứng khoán",
  "Nợ tăng dần qua từng năm này, giá tài sản tăng nhanh hơn thu nhập",
  "Thế thì bao giờ người Hàn Quốc mới nhận ra",
  "Về quan điểm đầu tư thì mỗi người lại nghĩ một kiểu",
  "Thậm chí là có những người vẫn tiếp tục vay tiền để đầu tư",
  "Đoàn bảy hiện nặng ở mức rất là cao",
  "Có đấy là cái điều đáng quan sát nhất",
]);

// One authored hero roughly every 20–45 seconds. This supersedes the older
// broad marker list above; a hero is a scarce visual event, not a label placed
// on every important sentence.
const SELECTED_HERO_SCENE_MARKERS = new Set([
  "Nhắc tới Hàn Quốc ngoài kim chi, phim", "Nhưng mà tại sao cái chuyện này",
  "Marin hay là giao dịch ký quỹ", "Nhưng mà vấn đề không phải là bạn cứ vay tiền",
  "Và cái thứ nguy hiểm nhất gọi là margin core", "Và đó chính xác là những gì đã xảy ra",
  "Nghe hợp lý mà có mà có một cái vấn đề", "Và điều này tạo ra một cảm giác khá là phổ biến",
  "Còn Marin thì giống như kiểu là đưa cho bạn một cái xe máy", "Nhưng mà đó mới chỉ là một nửa câu chuyện",
  "Còn ở Hàn Quốc ấy thì trong nhiều năm", "Đây là một tỉ lệ rất là cao và nó kéo thêm",
  "Nhiều người lại thích săn những mã cổ phiếu nhỏ", "Tức là đây là cái nhóm mà đạp ga mạnh nhất",
  "Đầu tiên là áp lực tài sản", "Nguyên nhân thì là một phần đến từ cấu trúc",
  "Và khi mà niềm tin và tính công bằng của thị trường", "Thêm vào đấy thì những cái nội dung tài chính",
  "Và khi mà tất cả những cái thứ đấy nó kết hợp lại", "CFD là viết tắt của Contracts for difference",
  "Và điều này khiến thị trường lại trở nên méo mó", "Nhưng mà những cái đấy thì nó cũng chỉ là xử lý phần ngọn",
  "Tức là khi mà không được chơi xong sân nhà", "và đôi khi nó sẽ chảy tới những cái nơi mà khó kiểm soát hơn",
  "Bây giờ bạn là một người Hàn Quốc khoảng 28 tuổi", "Cái đáng sợ nhất không phải là Marin",
  "Và điều chớ trêu nhá lại thị trường", "Thắng một phát không nghĩa là bạn là thiên tài chứng khoán",
  "Nợ tăng dần qua từng năm này, giá tài sản tăng nhanh hơn thu nhập",
  "Thế thì bao giờ người Hàn Quốc mới nhận ra", "Thậm chí là có những người vẫn tiếp tục vay tiền để đầu tư",
  "Đoàn bảy hiện nặng ở mức rất là cao",
]);

if (BASE_SCENES.length !== DIRECTIONS.length) {
  throw new Error(`Direction count ${DIRECTIONS.length} does not match scene count ${BASE_SCENES.length}`);
}

const PHOTO_DIRECTIONS: Record<string, { photo: string; treatment: PhotoTreatment }> = {
  "Và đó chính xác là những gì đã xảy ra": { photo: "backgrounds/evidence-market-pexels-10653886.jpg", treatment: "screen" },
  "Và cái điều đangng nói là phần lớn": { photo: "backgrounds/korea_apartments.jpg", treatment: "full_bleed" },
  "Và điều này tạo ra một cảm giác khá là phổ biến": { photo: "backgrounds/urban_apartments.jpg", treatment: "cutaway" },
  "và người trẻ Hàn Quốc có một cách dẫn đạt": { photo: "backgrounds/evidence-street-pexels-37319814.jpg", treatment: "full_bleed" },
  "Nhưng mà ở Hàn Quốc ấy thì mọi thứ lại cực đoan hơn": { photo: "backgrounds/market_monitor.jpg", treatment: "screen" },
  "Tức là họ chấp nhận nhiều rủi ro hơn, căng thẳng hơn": { photo: "backgrounds/evidence-document-pexels-33175657.jpg", treatment: "document" },
  "Trong suy nghĩ của nhiều người trẻ thì đây gần như": { photo: "backgrounds/evidence-document-pexels-8296970.jpg", treatment: "document" },
  "Và cuối cùng cũng là yếu tố quan trọng nhất": { photo: "backgrounds/mobile_trading_flatlay.jpg", treatment: "cutaway" },
  "Và khi mà tất cả những cái thứ đấy nó kết hợp lại": { photo: "backgrounds/trading_workstation.jpg", treatment: "screen" },
  "Trong đó thì ngày càng xuất hiện nhiều sản phẩm": { photo: "backgrounds/evidence-map-01.jpg", treatment: "map" },
  "và đôi khi nó sẽ chảy tới những cái nơi mà khó kiểm soát hơn": { photo: "backgrounds/evidence-map-03.jpg", treatment: "map" },
  "Nhưng mà tất cả những gì mà chúng ta vừa nói ở trên": { photo: "backgrounds/evidence-document-pexels-4386292.jpg", treatment: "document" },
  "Tại vì là khi mà cả một hệ thống": { photo: "backgrounds/evidence-document-pexels-8296974.jpg", treatment: "document" },
  "ấy những câu chuyện đổi đời xuất hiện khắp nơi": { photo: "backgrounds/evidence-housing-pexels-5505895.jpg", treatment: "full_bleed" },
  "thì cái việc họ bắt đầu tìm kiếm những lựa chọn rủi ro hơn": { photo: "backgrounds/evidence-street-pexels-37319834.jpg", treatment: "full_bleed" },
  "Về mặt cốt lõi thì đây vẫn là một trong những hệ quả": { photo: "backgrounds/evidence-market-pexels-16594724.jpg", treatment: "headline" },
  "Và trong suốt quá trình đó rất nhiều người tin rằng": { photo: "backgrounds/evidence-market-pexels-28682356.jpg", treatment: "screen" },
  "Về quan điểm đầu tư thì mỗi người lại nghĩ một kiểu": { photo: "backgrounds/stock_board.jpg", treatment: "headline" },
  "Và khi mà một hệ thống đã chất đầy đoàn bảy": { photo: "backgrounds/evidence-market-pexels-10653886.jpg", treatment: "screen" },
};

const SCENE_OVERRIDES: Record<string, Partial<AuthoredScene>> = {
  "Nhưng mà vấn đề không phải là bạn cứ vay tiền": {
    grammar: "CAUSE_EFFECT",
    slots: { cause: "Cổ phiếu giảm", effect: "Lỗ x2, nợ vẫn còn", causeIcon: "finance/trending_down", effectIcon: "finance/debt", relation: "khuếch đại" },
  },
  "và nếu bạn là người trẻ thì câu chuyện": {
    grammar: "EVIDENCE",
    slots: { title: "Việc làm thanh niên", body: "Khó tìm việc ổn định; thu nhập dài hạn yếu hơn", source: "KOSTAT · 2025" },
  },
  "Một cái đặc điểm khá là khác thường của chứng khoán": {
    grammar: "EVIDENCE",
    slots: { title: "Thị trường do cá nhân dẫn dắt", body: "Nhà đầu tư cá nhân chiếm tỷ trọng giao dịch rất lớn", source: "KRX · 2025" },
  },
  "Và cái điều buồn cười là sau khi cộng tất cả": {
    grammar: "EVIDENCE",
    slots: { title: "Hiệu quả ròng", body: "Sau phí giao dịch và lãi vay, kết quả thường thấp hơn", source: "KCMI · 2025" },
  },
  "Đến cuối năm 2024 thì lượng cổ phiếu nước ngoài": {
    grammar: "EVIDENCE",
    slots: { title: "Dòng tiền ra nước ngoài", body: "Quy mô nắm giữ cổ phiếu nước ngoài tăng rất lớn cuối 2024", source: "BOK · 2025" },
  },
  "Marin về bản chất thì nó giống như cái việc là gắn động cơ xe đua": {
    grammar: "CAUSE_EFFECT", visualRegister: "infographic", focalType: "diagram", characterRequired: false,
    slots: { cause: "Vốn thật", effect: "Sức mua lớn hơn", causeIcon: "finance/money", effectIcon: "finance/trending_up" },
  },
  "Rồi nó lại xuất hiện thêm những cái đợt bán tháo mới": {
    grammar: "CAUSE_EFFECT", visualRegister: "infographic", focalType: "diagram", characterRequired: false,
    slots: { cause: "Margin call", effect: "Bán tháo dây chuyền", causeIcon: "finance/debt", effectIcon: "finance/trending_down" },
  },
  "Còn Marin thì giống như kiểu là đưa cho bạn một cái xe máy": {
    grammar: "DIAGRAM", visualRegister: "infographic", focalType: "diagram", characterRequired: false,
    slots: { items: "Vốn thật|Tiền vay|Vị thế lớn", icons: "finance/money|finance/debt|finance/trending_up" },
  },
  "Họ sẽ lao vào sau khi đã đọc được vài cuốn sách": {
    grammar: "DIAGRAM", visualRegister: "infographic", focalType: "diagram", characterRequired: false,
    slots: { items: "Đọc ít|Tự tin quá|Đặt lệnh", icons: "props/book|props/brain|finance/investment" },
  },
  "Nghe kiểu cái kiến nhỏ nhỏ các thứ": {
    grammar: "DIAGRAM", visualRegister: "infographic", focalType: "diagram", characterRequired: false,
    slots: { items: "Một gaemi|Đám đông|Lực thị trường", icons: "characters/cat_investor_phone|characters/cat_investor_panic|finance/trending_up" },
  },
  "Nhiều người lại thích săn những mã cổ phiếu nhỏ": {
    grammar: "CAUSE_EFFECT", visualRegister: "infographic", focalType: "diagram", characterRequired: false,
    slots: { cause: "Mã nhỏ", effect: "Kỳ vọng jackpot", causeIcon: "finance/stock", effectIcon: "props/trophy" },
  },
  "Tức là đây là cái nhóm mà đạp ga mạnh nhất": {
    grammar: "EVIDENCE", visualRegister: "evidence", focalType: "evidence", characterRequired: false,
    slots: { title: "NHÓM DÙNG MARGIN", body: "Giao dịch thường xuyên hơn, rủi ro hơn và vị thế lớn hơn", source: "KCMI · 2021" },
  },
  "Chỉ cần cái điện thoại, một tài khoản giao dịch": {
    grammar: "DIAGRAM", visualRegister: "infographic", focalType: "diagram", characterRequired: false,
    slots: { items: "Điện thoại|Tài khoản|Lệnh mua", icons: "characters/cat_investor_phone|finance/investment|finance/trending_up" },
  },
  "Và khi mà niềm tin và tính công bằng của thị trường": {
    grammar: "CAUSE_EFFECT", visualRegister: "infographic", focalType: "diagram", characterRequired: false,
    slots: { cause: "Mất niềm tin", effect: "Đầu cơ ngắn hạn", causeIcon: "props/thought_bubble", effectIcon: "finance/trending_down" },
  },
  "Thêm vào đấy thì những cái nội dung tài chính": {
    grammar: "DIAGRAM", visualRegister: "infographic", focalType: "diagram", characterRequired: false,
    slots: { items: "Nội dung nóng|FOMO|Đặt lệnh", icons: "characters/cat_investor_phone|characters/cat_surprised|finance/investment" },
  },
};

// Explicit editorial substitutions for the over-used office/street stages.
// These are authored per narration beat; the numeric keys are stable scene
// ordinals in this locked transcript, not a modulo/layout generator.
const STAGE_OVERRIDES: Record<number, AuthoredScene["slots"]> = {
  4: { stage: "assets/scenes/classroom.svg", who: "hostShrug", anchorA: "board", prop: "props/brain", caption: "Tại sao lại là Hàn Quốc?" },
  9: { stage: "assets/scenes/bank_interior.svg", asker: "hostPoint", answerer: "investor", askerText: "Bạn có 100 triệu?", answererText: "Vay thêm, tôi mua được 200.", anchorA: "counter_left", anchorB: "counter_right" },
  14: { stage: "assets/scenes/bank_interior.svg", asker: "broker", answerer: "skeptic", askerText: "Nộp thêm tiền, ngay bây giờ.", answererText: "Không đủ? Cổ phiếu bị bán.", anchorA: "counter_left", anchorB: "counter_right" },
  34: { stage: "assets/scenes/subway_platform.svg", asker: "studentGirl", answerer: "landlord", askerText: "Sao tài sản cứ chạy xa?", answererText: "Người sở hữu giàu lên trước.", anchorA: "stand_left", anchorB: "stand" },
  43: { stage: "assets/scenes/shop_counter.svg", asker: "host", answerer: "investor", askerText: "Giá đang tăng, anh làm gì?", answererText: "Tôi đổ tiền vào ngay!", anchorA: "counter_left", anchorB: "counter_right" },
  55: { stage: "assets/scenes/cafe.svg", asker: "broker", answerer: "investor", askerText: "Dùng margin thì giao dịch sao?", answererText: "Nhiều hơn, lớn hơn, rủi ro hơn.", anchorA: "counter_left", anchorB: "counter_right" },
  62: { stage: "assets/scenes/bank_interior.svg", who: "regulator", anchorA: "counter_left", prop: "finance/stock", caption: "Chứng khoán = cơ hội đổi đời" },
  69: { stage: "assets/scenes/library.svg", who: "analyst", anchorA: "table_left", prop: "props/calendar", caption: "Không tin dài hạn, chơi ngắn hạn" },
  89: { stage: "assets/scenes/boardroom.svg", who: "host", anchorA: "center", prop: "props/thought_bubble", caption: "Dữ liệu méo mó, ai gánh rủi ro?" },
  109: { stage: "assets/scenes/bar.svg", who: "host", anchorA: "counter_right", prop: "props/trophy", caption: "Nhầm lẫn giữa may mắn và năng lực" },
};

const SEMANTIC_SETTING_OVERRIDES: Record<number, string> = {
  4: "classroom",
  62: "bank interior",
  69: "library",
  89: "office boardroom",
  109: "bar",
};

const ROLE_OVERRIDES: Record<number, AuthoredScene["slots"]> = {
  40: { answerer: "gaemi" },       // retail participation becomes a crowd behavior
  44: { answerer: "gaemi" },       // panic selling acts against the falling arrow
  49: { who: "gaemi" },            // FOMO is shown as a physical market reaction
  86: { who: "plainInvestor" },    // the contract reader explains CFD ownership
  110: { answerer: "plainInvestor" }, // skeptical receipt-checking undercuts luck
};

const EDITORIAL_OVERRIDES: Record<number, Partial<AuthoredScene>> = {
  0: {
    visualRegister: "evidence", focalType: "chart", characterRequired: false,
    semanticVisual: { subject: "KOSPI loss figure", action: "lands as the opening shock", takeaway: "KOSPI fell more than 18 percent in days", object: "KOSPI -18%" },
    silentFrameTakeaway: "KOSPI -18% shock", focalOccupancyTarget: 0.50,
  },
  1: {
    visualRegister: "evidence", focalType: "evidence", characterRequired: false,
    semanticVisual: { subject: "margin lending ceiling", action: "shows brokers pausing loans", takeaway: "margin credit reached a lending limit", object: "margin ceiling" },
    silentFrameTakeaway: "broker margin ceiling", focalOccupancyTarget: 0.52,
  },
  2: {
    visualRegister: "infographic", focalType: "diagram", characterRequired: true,
    semanticVisual: { subject: "central questions", action: "asks why borrowing and margin spread", takeaway: "the episode investigates leverage", object: "two questions" },
    silentFrameTakeaway: "two questions about margin", focalOccupancyTarget: 0.48,
  },
  3: {
    visualRegister: "full_tableau", focalType: "full_scene", characterRequired: true,
    semanticVisual: { subject: "host", action: "introduces the leverage story", takeaway: "this episode explains Korea's leverage boom", setting: "library" },
    silentFrameTakeaway: "host introduces the episode", focalOccupancyTarget: 0.42,
  },
  83: {
    grammar: "TABLEAU",
    visualRegister: "full_tableau",
    focalType: "full_scene",
    characterRequired: true,
    slots: {
      stage: "assets/scenes/classroom.svg",
      who: "analyst",
      anchorA: "board",
      prop: "props/concept_card",
      caption: "Bốn lực, một cơn sốt",
    },
  },
  91: {
    grammar: "TABLEAU",
    visualRegister: "full_tableau",
    focalType: "full_scene",
    characterRequired: true,
    slots: {
      stage: "assets/scenes/airport.svg",
      who: "regulator",
      anchorA: "stand",
      prop: "finance/exchange",
      caption: "Đóng cửa, tiền đổi lối",
    },
  },
  113: {
    grammar: "TABLEAU",
    visualRegister: "full_tableau",
    focalType: "full_scene",
    characterRequired: true,
    slots: {
      stage: "assets/scenes/bedroom.svg",
      who: "youngperson",
      anchorA: "bed",
      prop: "finance/debt",
      caption: "Nợ tăng, thu nhập hụt hơi",
    },
  },
  125: {
    grammar: "TABLEAU",
    visualRegister: "full_tableau",
    focalType: "full_scene",
    characterRequired: true,
    slots: {
      stage: "assets/scenes/construction.svg",
      who: "hostShrug",
      anchorA: "stand",
      prop: "finance/house",
      caption: "Xây tài sản, không tăng cược?",
    },
  },
  52: {
    grammar: "PHOTO_EVIDENCE",
    visualRegister: "photo_broll",
    focalType: "screenshot",
    characterRequired: false,
    photoTreatment: "document",
    slots: {
      photo: "backgrounds/evidence-document-pexels-4386292.jpg",
      caption: "Thiên kiến quen thuộc và hành vi bầy đàn là hiện tượng toàn cầu",
      source: "Behavioral finance research",
    },
  },
  57: {
    grammar: "CAUSE_EFFECT",
    visualRegister: "infographic",
    focalType: "chart",
    characterRequired: false,
    slots: {
      cause: "Thị trường tăng: lãi mạnh nhất",
      effect: "Thị trường sập: đau nhất",
      causeIcon: "finance/trending_up",
      effectIcon: "finance/trending_down",
      relation: "đòn bẩy khuếch đại cả hai chiều",
    },
  },
  58: {
    grammar: "CAUSE_EFFECT",
    visualRegister: "infographic",
    focalType: "chart",
    characterRequired: false,
    slots: {
      cause: "Lợi nhuận trước chi phí",
      effect: "Phí + lãi vay → hiệu quả ròng thấp",
      causeIcon: "finance/investment",
      effectIcon: "finance/debt",
      relation: "chi phí bào mòn kết quả",
    },
  },
  61: {
    grammar: "POLICY_LIST",
    visualRegister: "infographic",
    focalType: "diagram",
    characterRequired: false,
    slots: {
      items: "Áp lực tài sản|Việc làm bất ổn|Công nghệ giao dịch|Văn hóa đổi đời",
      icons: "finance/house|characters/cat_worker|characters/cat_investor_phone|finance/investment",
    },
  },
};

// Evidence sources are authored with the claim, not invented by a renderer.
// `sourceMarker` is resolved to an exact transcript range by build-storyboard.
export const CLAIMS: StoryClaim[] = [
  {
    id: "household-credit-2025", text: "Household credit exceeded KRW 1,900 trillion in 2025.",
    sourceMarker: "Cuối năm 2025 thì tổng nợ tín dụng hộ gia đình", sourceRange: undefined as any, evidencePolicy: "data",
    publisher: "Bank of Korea", title: "Financial Stability Report", date: "2025-06", checkedDate: "2026-08-03",
    url: "https://www.bok.or.kr/eng/bbs/E0000634/view.do?depth=400069&menuNo=400069&nttId=10096591",
    shortSourceLabel: "BOK · 2025",
  },
  {
    id: "retail-participation", text: "Retail participation is a defining feature of Korea's equity market.",
    sourceMarker: "Một cái đặc điểm khá là khác thường", sourceRange: undefined as any, evidencePolicy: "source_card",
    publisher: "Korea Exchange", title: "Solid Investor Base", date: "2025", checkedDate: "2026-08-03",
    url: "https://global.krx.co.kr/contents/GLB/03/0301/0301030000/GLB0301030000.jsp",
    shortSourceLabel: "KRX · 2025",
  },
  {
    id: "margin-behaviour", text: "Retail margin users show distinctive high-risk trading behaviour.",
    sourceMarker: "Tức là đây là cái nhóm mà đạp ga mạnh nhất", sourceRange: undefined as any, evidencePolicy: "source_card",
    publisher: "Korea Capital Market Institute", title: "Margin Trading in Korea's Stock Market", date: "2021", checkedDate: "2026-08-03",
    url: "https://www.kcmi.re.kr/en/report/report_view?report_no=1479",
    shortSourceLabel: "KCMI · 2021",
  },
];

export const SECTIONS: StorySection[] = [
  { id: "act-1-margin", sourceMarker: "Nhắc tới Hàn Quốc ngoài kim chi", sourceRange: undefined as any,
    thesis: "Margin makes a small market move a personal debt crisis.", emotionalTurn: "curiosity to shock",
    energyCurve: "climax", heroConcept: "KOSPI shock and margin call", treatmentSequence: ["full_tableau", "evidence", "framebox"] },
  { id: "act-2-pressure", sourceMarker: "Và đó chính xác là những gì đã xảy ra", sourceRange: undefined as any,
    thesis: "Housing, jobs and the wealth gap make leveraged investing emotionally plausible.", emotionalTurn: "shock to empathy",
    energyCurve: "sustain", heroConcept: "young worker chasing an unaffordable home", treatmentSequence: ["photo_broll", "full_tableau", "infographic"] },
  { id: "act-3-system", sourceMarker: "Nhưng mà đó mới chỉ là một nửa câu chuyện", sourceRange: undefined as any,
    thesis: "Market structure, regulation and behaviour amplify the risk.", emotionalTurn: "empathy to diagnosis and release",
    energyCurve: "build", heroConcept: "debt-loaded gaemi crowd", treatmentSequence: ["evidence", "visual_gag", "full_tableau", "framebox"] },
];

const CLAIM_IDS_BY_MARKER: Record<string, string[]> = {
  "Cuối năm 2025 thì tổng nợ tín dụng hộ gia đình": ["household-credit-2025"],
  "Một cái đặc điểm khá là khác thường của chứng khoán": ["retail-participation"],
  "Tức là đây là cái nhóm mà đạp ga mạnh nhất": ["margin-behaviour"],
};

export const SCENES: AuthoredScene[] = BASE_SCENES.map((scene, index) => {
  const photo = PHOTO_DIRECTIONS[scene.marker];
  const markerOverride = SCENE_OVERRIDES[scene.marker] ?? {};
  const editorialOverride = EDITORIAL_OVERRIDES[index] ?? {};
  const override = { ...markerOverride, ...editorialOverride };
  const direction = DIRECTIONS[index];
  const semanticSetting = SEMANTIC_SETTING_OVERRIDES[index];
  const authoredSlots = {
    ...(scene.slots ?? {}),
    ...(STAGE_OVERRIDES[index] ?? {}),
    ...(ROLE_OVERRIDES[index] ?? {}),
    ...(markerOverride.slots ?? {}),
    ...(editorialOverride.slots ?? {}),
  };
  return {
    ...scene,
    ...direction,
    ...(semanticSetting ? {
      semanticVisual: { ...direction.semanticVisual, setting: semanticSetting },
    } : {}),
    ...override,
    claimIds: CLAIM_IDS_BY_MARKER[scene.marker],
    slots: authoredSlots,
    ...(photo ? {
      photoTreatment: photo.treatment,
      slots: { ...authoredSlots, photo: photo.photo },
    } : {}),
    heroVisual: SELECTED_HERO_SCENE_MARKERS.has(scene.marker),
  };
});

const missingPhotoDirection = SCENES.filter((scene) => scene.grammar === "PHOTO_EVIDENCE" && !scene.photoTreatment);
if (missingPhotoDirection.length) {
  throw new Error(`Missing authored photo treatment for ${missingPhotoDirection.map((scene) => scene.marker).join(", ")}`);
}
