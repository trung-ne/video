// Session-authored Route A storyboard.  Each entry is an intentional beat in
// the narration; the small constructor only keeps the schema contract legible.
type G = any;
const scene = (marker: string, grammar: string, emotion: string, purpose: string,
  viewerFocus: string, visualRegister: string, focalType: string, slots: Record<string, string>,
  subject: string, action: string, takeaway: string, opts: any = {}) => ({
  marker, grammar, emotion, purpose, viewerFocus, visualRegister, focalType, slots,
  semanticVisual: {subject, action, takeaway, setting: opts.setting},
  silentFrameTakeaway: takeaway, focalOccupancyTarget: opts.focal ?? 0.28,
  characterRequired: opts.characterRequired ?? /character_action|full_tableau|visual_gag/.test(visualRegister),
  narrationOverride: opts.narrationOverride,
  heroVisual: opts.heroVisual, shot: opts.shot ?? "medium", ttsInstruction: opts.tts,
  captionTreatment: opts.captionTreatment ?? "none", evidenceTreatment: opts.evidenceTreatment ?? "none",
  photoTreatment: opts.photoTreatment, beats: opts.beats,
});

export const CAST = {
  host: {src: "characters/cat_explain", poseFamily: "narrator" as const},
  investor: {src: "characters/cat_talk"},
  skeptic: {src: "characters/cat_think"},
  worried: {src: "characters/cat_sad"},
  shocked: {src: "characters/cat_surprised"},
  worker: {src: "characters/cat_worker"}, homebuyer: {src: "characters/cat_homebuyer"},
  debtor: {src: "characters/cat_debt_burden"}, phoneInvestor: {src: "characters/cat_investor_phone"},
  contractInvestor: {src: "characters/cat_investor_contract"}, panicInvestor: {src: "characters/cat_investor_panic"},
  business: {src: "characters/cat_business"}, teacher: {src: "characters/cat_teacher"},
  parent: {src: "characters/cat_dad"}, mother: {src: "characters/cat_mom"}, police: {src: "characters/cat_police"}, cool: {src: "characters/cat_sunglasses"},
};

export const VISUAL_TREATMENT_PLAN = {
  registerTargets: {character_action: 0.19, infographic: 0.14, evidence: 0.08, photo_broll: 0.08, framebox: 0.10, visual_gag: 0.06, full_tableau: 0.42},
  characterFreeTarget: 0.22,
  heroConcepts: ["KOSPI crash", "margin multiplier", "margin call cascade", "CFD opacity", "pressure behind speculation", "water finding another channel"],
  visualMotifs: ["phone buy button", "red downward arrow", "loan rope", "water-flow detour", "apartment price wall"],
  forbiddenRepeats: ["two consecutive SOLO scenes", "wallpaper photo behind a cat", "happy cat for losses", "repeated centered narrator"],
  usageBudgets: {maximumAssetUses: 12, maximumStageRatio: 0.05, maximumPoseRatio: 0.08, maximumConsecutiveSameStage: 2, maximumPhotoTreatmentRatio: 0.35, maximumStatRevealRatio: 0.08},
  requiredVisualModes: ["character_action", "infographic", "evidence", "photo_broll", "framebox", "visual_gag", "full_tableau"],
  heroCadenceSeconds: 40, paletteProfile: "editorial-muted-v2" as const,
};

export const SCENES: G[] = [
scene("Nhắc tới Hàn Quốc", "PHOTO_EVIDENCE", "urgent", "Cold-open on the market shock, before explaining why it happened.", "CPI down more than 18%", "photo_broll", "photo", {photo:"backgrounds/stock_board.jpg", caption:"Đầu 2026: CPI Hàn Quốc lao dốc hơn 18%"}, "stock board", "plunges", "A sharp market fall erased huge value in days.", {heroVisual:true, photoTreatment:"full_bleed", focal:.65, narrationOverride:"Nhắc tới Hàn Quốc, ngoài kim chi và phim tình cảm, còn có một vấn đề đau đầu: ngày càng nhiều người xem đầu tư là con đường ngắn nhất để đổi đời."}),
scene("Những cái thứ như", "ICON_TRIPLE", "concern", "Show the broad hunt for anything that might rise in price.", "Cổ phiếu, tiền số, bất động sản", "infographic", "diagram", {items:"Cổ phiếu|Tiền số|Bất động sản", icons:"finance/stock|finance/crypto|finance/house"}, "young savers", "chase three rising assets", "Anything that can rise attracts a rush.", {narrationOverride:"Cổ phiếu, tiền số, bất động sản: bất cứ tài sản nào có khả năng tăng giá cũng thu hút người đầu tư."}),
scene("Và cái thứ mà khiến", "CHAR_PROP", "urgent", "Name margin as the extra ingredient that turns the rush dangerous.", "Giao dịch ký quỹ", "character_action", "character_action", {who:"host", prop:"finance/loan", label:"Tiền vay làm cuộc chơi nguy hiểm hơn"}, "host", "points at a loan", "Borrowed money turns a risky rush into a dangerous one.", {narrationOverride:"Điều khiến cuộc chơi nguy hiểm hơn rất nhiều là dùng tiền mượn để đầu tư."}),
  scene("Hậu quả bắt đầu lộ rõ", "PHOTO_EVIDENCE", "urgent", "Land the stated early-2026 crash as an evidence punch.", "Hơn 18% chỉ trong vài ngày", "photo_broll", "photo", {photo:"backgrounds/stock_chart.jpg", caption:"Đầu 2026: chỉ số lao dốc hơn 18%"}, "market chart", "falls sharply", "The fall was sudden and severe.", {photoTreatment:"headline", focal:.62, narrationOverride:"Chỉ trong vài ngày, giá cổ phiếu ở Hàn Quốc đã giảm rất mạnh."}),
scene("Nhưng mà điều đáng chú ý", "CHAR_PROP", "concern", "Reveal that the crash met investors already loaded with borrowed money.", "loan limit reached", "character_action", "character_action", {who:"worried", prop:"finance/loan", label:"Nhiều công ty phải tạm dừng cho vay"}, "worried investor", "clutches a loan document", "Borrowing was already at the limit.", {narrationOverride:"Rất nhiều nhà đầu tư đã đi vay số tiền lớn. Khi hạn mức cho vay chạm mức tối đa, một số công ty chứng khoán đã phải tạm ngừng cung cấp vốn vay cho các nhà đầu tư."}),
  scene("Nhưng mà tại sao", "DIALOGUE_QA", "curious", "Ask the central puzzle: why leverage in a mature Asian economy?", "Why borrow to bet?", "character_action", "character_action", {asker:"skeptic", answerer:"host", askerText:"Sao lại vay tiền để cược?", answererText:"Vì cả hệ thống đang đẩy họ vào cuộc chơi."}, "two cats", "debate the puzzle", "This is a systemic story, not a simple greed story.", {narrationOverride:"Điều gì đã tạo ra hiện tượng này ở Hàn Quốc? Hàn Quốc có nền kinh tế phát triển, chứ không phải một thị trường mới nổi. Quốc gia này nằm trong nhóm các nền kinh tế lớn nhất châu Á. Trước đây, biến động tỷ giá giữa nhiều đồng tiền, việc đi mượn tiền và tình trạng bất ổn trên thị trường tiền tệ lẫn thị trường đầu tư đã nhiều lần làm kinh tế Hàn Quốc suy yếu. Các nhà đầu tư tại Hàn Quốc nổi tiếng vì làm việc hiệu quả trong môi trường cạnh tranh rất khắc nghiệt và đặc biệt đề cao nguyên tắc. Vậy tại sao nhiều người vẫn lấy tiền mượn để đầu tư, rồi xem biến động trên thị trường như một cuộc đỏ đen với kết quả do vận may quyết định? Vì sao dùng vốn vay để tăng quy mô đầu tư lại dần trở thành cách làm phổ biến? Video này sẽ cùng bạn tìm lời giải. Tôi là con mèo kể chuyện. Hôm nay, câu chuyện nói về phong trào đầu tư sôi sục ở Hàn Quốc bằng nguồn tiền đi vay."}),
  scene("Trước tiên", "QA_REVEAL", "neutral", "Define margin in plain language.", "Margin = borrowed investing", "infographic", "diagram", {q:"Margin là gì?", a:"Vay tiền công ty chứng khoán để mua thêm cổ phiếu."}, "margin", "is defined", "Margin adds borrowed capital to an investment.", {narrationOverride:"Trong tài chính, dùng tiền đi mượn để tăng quy mô đầu tư được gọi là sử dụng vốn đi mượn. Cách này làm tổng giá trị đầu tư lớn hơn. Trên thị trường cổ phiếu, nhà đầu tư có thể mượn tiền từ công ty chứng khoán, rồi dùng số tiền mượn được để mua thêm cổ phiếu. Hoạt động đó được gọi là giao dịch ký quỹ, tức là mua cổ phiếu bằng nguồn tiền đi mượn. Nói đơn giản, nguồn tiền đi mượn giúp bạn mua nhiều cổ phiếu hơn số tiền tự có của mình."}),
scene("Ví dụ như là bạn có 100 triệu", "COMPARE", "neutral", "Make the 100 versus 200 million buying power intuitive.", "100 triệu thành 200 triệu sức mua", "infographic", "diagram", {left:"Vốn của bạn: 100 triệu", right:"Có margin: mua 200 triệu", leftAsset:"finance/wallet", rightAsset:"finance/loan"}, "two portfolios", "contrast cash with borrowed buying power", "A loan doubles the position size."),
  scene("Nếu mà cổ phiếu tăng 10%", "STAT_REVEAL", "surprise", "Show why leverage feels attractive when prices rise.", "Lãi 20 triệu", "infographic", "chart", {stat:"+20 TRIỆU", anchor:"finance/profit", caption:"khi vị thế 200 triệu tăng 10%"}, "profit icon", "reveals doubled gain", "Leverage magnifies gains.", {narrationOverride:"Giả sử giá cổ phần tăng 10 phần trăm. Với một vị thế được mua bằng tiền mượn, lợi nhuận khi đó vào khoảng 20 triệu đồng. Cũng với mức tăng ấy, nếu chỉ đầu tư bằng tiền của mình thì lợi nhuận chỉ vào khoảng 10 triệu đồng. Nguyên lý rất đơn giản: tiền mượn cho phép nhà đầu tư mua nhiều cổ phần hơn; vì vậy, quy mô đầu tư cũng lớn hơn."}),
scene("Nhưng mà vấn đề", "STAT_REVEAL", "concern", "Immediately invert the previous promise with the loss side.", "Lỗ cũng x2", "infographic", "chart", {stat:"LỖ ×2", anchor:"finance/loss", caption:"giá giảm 10%, nợ và lãi vẫn còn"}, "loss icon", "drops", "Leverage magnifies losses too.", {narrationOverride:"Dùng tiền đi mượn để đầu tư không có nghĩa là giá cổ phiếu chắc chắn tăng. Nếu giá cổ phiếu mất đến chín mươi phần trăm giá trị, khoản lỗ của bạn sẽ lớn gấp hai lần. Dù giá cổ phiếu đi xuống, bạn vẫn phải hoàn trả nợ gốc và trả toàn bộ các chi phí phát sinh từ số tiền đã mượn."}),
scene("Marin về bản chất", "VISUAL_METAPHOR", "urgent", "Turn margin into a racing-car metaphor.", "Động cơ xe đua gắn vào danh mục", "visual_gag", "visual_gag", {setup:"Danh mục + động cơ xe đua", payoff:"Cua gấp là văng khỏi đường" ,leftAsset:"finance/portfolio", rightAsset:"props/muscle_arm"}, "portfolio", "gets a dangerous turbo", "More speed also means a harder crash."),
scene("Và cái thứ nguy hiểm nhất", "CHAR_PROP", "urgent", "Introduce the margin call as the moment of coercion.", "Margin call", "character_action", "character_action", {who:"shocked", prop:"finance/debt", label:"Nộp thêm tiền — hoặc bị bán cổ phiếu"}, "shocked investor", "receives a debt notice", "A margin call forces cash or forced selling."),
scene("Và vấn đề nó thường", "CAUSE_EFFECT", "urgent", "Explain the self-reinforcing liquidation loop.", "Bán tháo kéo giá xuống", "infographic", "diagram", {cause:"Giá giảm → margin call", effect:"Cùng bán → giá giảm mạnh hơn", causeIcon:"finance/trending_down", effectIcon:"finance/loss", relation:"vòng lặp"}, "market", "spirals downward", "Forced sales create more forced sales."),
scene("Nó giống như kiểu", "VISUAL_METAPHOR", "concern", "Use the falling-staircase image as the cascade payoff.", "Một người ngã, cả hàng ngã theo", "visual_gag", "visual_gag", {setup:"Một người trượt chân", payoff:"Cả hàng trên cầu thang đổ xuống", leftAsset:"characters/cat_surprised", rightAsset:"finance/trending_down"}, "row of investors", "topples like dominoes", "The cascade is collective."),
scene("Và cú sập này", "PHOTO_EVIDENCE", "sad", "Open the structural explanation by connecting the crash to a generation's view of wealth.", "Cú sập bắt đầu từ áp lực làm giàu", "photo_broll", "photo", {photo:"backgrounds/office_trading.jpg", caption:"Áp lực làm giàu tích tụ trước cú sập"}, "trading desk", "sits empty after a selloff", "The crash grew from pressures that existed long before the selloff.", {photoTreatment:"cutaway", focal:.6}),
  scene("Cuối năm 2025", "EVIDENCE", "surprise", "Land the household-credit scale, then identify housing as the debt's main destination.", "Nợ hộ gia đình tiến sát 2.000 tỷ", "evidence", "evidence", {title:"Nợ hộ gia đình gần 2.000 tỷ", body:"Phần lớn khoản nợ liên quan đến nhà ở."}, "household debt", "shows the debt figure beside a house", "Housing debt makes the headline number personal.", {evidenceTreatment:"source-card", focal:.45, narrationOverride:"Khi hai nghìn không trăm hai mươi lăm khép lại, tổng dư nợ của các hộ gia đình Hàn Quốc trong hệ thống tín dụng đã xấp xỉ hai nghìn tỷ. Quy mô số nợ này rất lớn. Đáng ngại hơn, phần lớn số nợ ấy gắn với nhà ở."}),
scene("Hàn Quốc có một mô hình", "QA_REVEAL", "neutral", "Introduce the distinctive Jeonse rental arrangement in plain language.", "Jeonse: đặt cọc lớn thay cho tiền thuê tháng", "infographic", "diagram", {q:"Thuê nhà mà không trả tiền mỗi tháng?", a:"Người thuê đưa một khoản đặt cọc rất lớn cho chủ nhà."}, "rental contract", "reveals the Jeonse deposit arrangement", "The arrangement trades monthly rent for a very large upfront deposit."),
scene("Nhiều trường hợp là", "COMPARE", "concern", "Show the scale of the deposit and the years of rent-free occupancy it buys.", "Đặt cọc tới nửa giá trị căn nhà", "infographic", "diagram", {left:"Đặt cọc: tới 1/2 giá nhà", right:"Ở vài năm, không trả thuê tháng", leftAsset:"finance/wallet", rightAsset:"finance/house"}, "tenant and house", "weigh a huge deposit against rent-free years", "The upfront payment is enormous even when monthly rent disappears."),
scene("Nghe hợp lý mà có mà có", "CHAR_PROP", "concern", "Expose the upfront-cash barrier and explain why low rates once made the system feel comfortable.", "Khoản tiền vào quá lớn", "character_action", "character_action", {who:"worried", prop:"finance/wallet", label:"Muốn thuê nhà phải có sẵn tiền lớn"}, "young renter", "stares at an oversized deposit wallet", "Low interest rates made the large deposit seem manageable."),
scene("Người thuê thì không phải", "CAUSE_EFFECT", "sad", "Turn the rate rise into its consequence: landlords struggle to return deposits and tenants absorb the first pressure.", "Lãi suất tăng → tiền cọc khó hoàn", "infographic", "diagram", {cause:"Lãi suất tăng", effect:"Chủ nhà khó trả cọc; người thuê chịu áp lực", causeIcon:"finance/interest_rate", effectIcon:"finance/debt"}, "rental system", "connects rising rates to trapped tenant deposits", "The apparent win becomes a burden when the contract ends."),
scene("Tại vì tỉ lệ có việc làm", "FULL_SCENE_ACTION", "sad", "Humanize the burden with insecure youth employment and slowly rising income.", "Việc làm bấp bênh, thu nhập tăng chậm", "full_tableau", "full_scene", {stage:"assets/scenes/office-desk.svg", who:"worried", anchorA:"props/calendar", prop:"finance/wallet", caption:"Hợp đồng ngắn hạn, việc làm thiếu ổn định"}, "young worker", "faces an expiring contract and a thin wallet", "Unstable work leaves young renters least able to carry the pressure.", {setting:"office"}),
scene("Vì thế nên là", "CAUSE_EFFECT", "concern", "Connect slow income growth and rising costs to the widening gap from the previous generation.", "Thu nhập chậm hơn chi phí và giá tài sản", "infographic", "diagram", {cause:"Thu nhập tăng chậm", effect:"Nhà và tích lũy ngày càng xa", causeIcon:"finance/wallet", effectIcon:"finance/house"}, "young generation", "falls behind rising living costs and asset prices", "Hard work no longer appears to close the generational gap."),
scene("Và trong bối cảnh như thế", "CHAR_PROP", "urgent", "Show why financial markets begin to look like an attractive shortcut rather than a casual choice.", "Chứng khoán trông như đường tắt", "character_action", "character_action", {who:"investor", prop:"props/computer_desk", label:"Khi lương chậm hơn giá tài sản"}, "young investor", "reaches toward a trading screen", "The market looks like an alternative route to catch up."),
scene("Còn Marin thì", "VISUAL_METAPHOR", "urgent", "Make leverage tangible as a faster motorbike on an already risky shortcut.", "Con đường tắt + chiếc xe nhanh hơn", "visual_gag", "visual_gag", {setup:"Đường tắt chứng khoán", payoff:"Tiền vay làm chiếc xe chạy nhanh hơn", leftAsset:"finance/stock", rightAsset:"finance/loan"}, "leveraged investor", "rides a fast motorbike toward a risky shortcut", "More speed brings more risk."),
scene("Nhưng mà tốc độ cao", "CHAR_PROP", "sad", "Give the feeling of being left behind a quiet emotional frame.", "Cảm giác bị bỏ lại phía sau", "character_action", "character_action", {who:"worried", prop:"finance/house", label:"Giá nhà và tài sản đều tăng tốc"}, "young person", "watches a house and assets pull away", "Rising asset prices make standing still feel like falling behind.", {shot:"close"}),
scene("Và khi mà cảm giác đó", "DIALOGUE_QA", "urgent", "Show social pressure turning into rushed financial decisions.", "Không chạy nhanh thì khoảng cách lớn hơn?", "character_action", "character_action", {asker:"worried", answerer:"host", askerText:"Nếu không chạy nhanh hơn thì sao?", answererText:"Cảm giác bị bỏ lại khiến người ta lao vào đầu tư."}, "two cats", "connect time pressure to a risky decision", "The fear of falling behind changes financial choices."),
scene("Nhưng mà đó mới chỉ", "EVIDENCE", "neutral", "Pivot from household pressure to the stock market structure that amplifies it.", "Nửa còn lại: cấu trúc thị trường", "evidence", "evidence", {title:"Cấu trúc chứng khoán Hàn Quốc", body:"Nhà đầu tư cá nhân chiếm tỉ trọng giao dịch rất lớn."}, "market structure card", "introduces the second half of the explanation", "The market's participant mix changes how sentiment moves prices.", {evidenceTreatment:"source-card", focal:.45}),
scene("Ở nhiều thị trường phát triển", "COMPARE", "neutral", "Contrast institution-led trading elsewhere with Korea's individual-investor liquidity.", "Ai dẫn dắt giao dịch hằng ngày?", "infographic", "diagram", {left:"Nhiều thị trường: quỹ, ngân hàng, tổ chức", right:"Hàn Quốc: cá nhân chiếm phần lớn thanh khoản", leftAsset:"people/company", rightAsset:"people/person"}, "two market structures", "contrast institutional flow with retail-led liquidity", "Retail investors play an unusually large short-term role in Korea."),
scene("Năm 2020", "EVIDENCE", "surprise", "Anchor the unusual retail dominance with the stated 2020 and 2026 shares.", "2/3 giao dịch năm 2020; khoảng 60% năm 2026", "evidence", "evidence", {title:"6 trên 10 lệnh", body:"Đến từ nhà đầu tư cá nhân; năm 2020 từng khoảng hai phần ba."}, "retail trading share", "shows the retail share on a source card", "A large retail share makes crowd emotion market-moving.", {evidenceTreatment:"source-card", focal:.45, narrationOverride:"Vào năm 2020, giới đầu tư cá nhân đã tạo ra gần hai phần ba toàn bộ giao dịch. Sang năm 2026, nhóm này vẫn thường chiếm khoảng 60 phần trăm số giao dịch. Quy ra mười lệnh mua hoặc bán trên thị trường thì sáu lệnh được chính nhà đầu tư cá nhân thực hiện."}),
scene("Đây là một tỉ lệ rất là cao", "CAUSE_EFFECT", "urgent", "Explain the symmetric rush: enthusiasm pulls money in and panic releases selling pressure just as fast.", "Hưng phấn → mua mạnh; hoảng loạn → bán mạnh", "infographic", "diagram", {cause:"Tâm lý đám đông", effect:"Dòng tiền và lực bán đổi hướng rất nhanh", causeIcon:"people/person", effectIcon:"finance/trending_down"}, "retail crowd", "swings from buying rush to selling rush", "Crowd sentiment makes the market more sensitive."),
scene("Người Hàn Quốc thậm chí", "VISUAL_METAPHOR", "sarcastic", "Use the ant nickname to show how many small investors can create a large force, especially with leverage.", "Một triệu con kiến cùng chạy", "visual_gag", "visual_gag", {setup:"Gamy = đàn kiến", payoff:"Đàn kiến cùng hướng tạo lực đẩy lớn", leftAsset:"people/person", rightAsset:"finance/loan"}, "retail investor crowd", "surges in one direction carrying borrowed money", "Small individual orders become powerful when they move together."),
scene("Những nghiên cứu về hành vi", "ICON_TRIPLE", "concern", "Name the familiar behavioral mistakes: herd following, fear of missing out, and lottery-like small stocks.", "Đám đông, FOMO, cổ phiếu rủi ro cao", "infographic", "diagram", {items:"Thấy người khác mua|Sợ lỡ sóng tăng|Săn cổ phiếu nhỏ rủi ro", icons:"people/person|finance/chart_up|finance/stock"}, "retail biases", "groups three recurring investing mistakes", "The most active traders are vulnerable to familiar behavioral traps."),
scene("Một cái xu hướng khác", "COMPARE", "concern", "Show the disposition pattern: take winners too early, but keep losers while hoping for a reversal.", "Chốt lời sớm, ôm lỗ lâu", "infographic", "diagram", {left:"Khoản có lời: bán quá sớm", right:"Khoản lỗ: giữ và chờ giá quay đầu", leftAsset:"finance/profit", rightAsset:"finance/loss"}, "two investment outcomes", "contrasts early selling with holding losses", "This behavioral-finance pattern is not unique to Korea, but leverage intensifies it there."),
scene("Nhưng mà ở Hàn Quốc ấy", "STAT_REVEAL", "urgent", "Identify the margin users as a small group that produces disproportionately many trades.", "Ít người dùng margin, rất nhiều giao dịch", "infographic", "chart", {stat:"NHÓM NHỎ, GIAO DỊCH LỚN", anchor:"finance/loan", caption:"Theo các nghiên cứu tại KCMI"}, "margin users", "outsize their share of trading activity", "The most leveraged group is also the most active."),
scene("Tại vì là đội này", "CHAR_PROP", "urgent", "Show the concentrated, volatile, loan-powered portfolio and the unequal crash outcome.", "Đạp ga mạnh nhất bằng tiền vay", "character_action", "character_action", {who:"investor", prop:"finance/loan", label:"Giao dịch thường xuyên, danh mục tập trung, rủi ro cao"}, "leveraged trader", "presses the accelerator on a debt-powered portfolio", "They profit more in calm markets but suffer the first and worst crashes."),
scene("Và cái điều buồn cười", "QA_REVEAL", "sad", "Close the evidence with the cost-adjusted result and the paradox of Korea's margin frenzy.", "Rủi ro nhiều hơn, kết quả không tốt hơn", "infographic", "diagram", {q:"Giao dịch nhiều và chấp nhận rủi ro cao có tốt hơn không?", a:"Sau phí, lãi vay và lỗ phát sinh, thường không; nhiều trường hợp còn kém hơn."}, "margin paradox", "reveals the poor cost-adjusted outcome", "That is the central paradox of the margin frenzy in Korea."),
scene("Đầu tiên là áp lực tài sản", "FULL_SCENE_ACTION", "concern", "Start cause one: housing rose beyond ordinary accumulation.", "Giá nhà chạy xa thu nhập", "full_tableau", "full_scene", {stage:"assets/scenes/street.svg", who:"worried", anchorA:"finance/house", prop:"finance/trending_up", caption:"Nhà tăng quá nhanh"}, "young worker", "looks up at an unreachable house", "Housing feels out of reach through normal saving.", {setting:"city street"}),
scene("Và chứng khoán", "CHAR_PROP", "hopeful", "Show the phone-and-account promise of a shortcut.", "Một chiếc điện thoại, một nút bấm", "character_action", "character_action", {who:"investor", prop:"props/computer_desk", label:"Cơ hội đổi đời trong túi"}, "young investor", "reaches for a trading screen", "The market feels like the last accessible ladder."),
scene("Và cũng như đã nói", "DIALOGUE_QA", "concern", "Counter the shortcut story with the risk warning.", "Cơ hội lớn, rủi ro lớn", "character_action", "character_action", {asker:"investor", answerer:"host", askerText:"Có cơ hội đổi đời không?", answererText:"Có — nhưng lãi to hơn, mất cũng nhanh hơn."}, "two cats", "weigh opportunity against danger", "The shortcut carries amplified risk."),
scene("Gốc rễ thứ hai", "EVIDENCE", "neutral", "Name the Korea Discount and frame it as a belief about long-term ownership.", "Korea Discount", "evidence", "evidence", {title:"Korea Discount", body:"Nhiều cổ phiếu Hàn Quốc được tin là bị định giá thấp hơn doanh nghiệp tương tự ở các nước phát triển."}, "evidence card", "states the valuation belief", "Weak faith in long holding changes investor behavior.", {evidenceTreatment:"source-card", focal:.45}),
scene("Nguyên nhân thì là", "DIAGRAM", "concern", "Lay out the governance and minority-shareholder tensions behind that belief.", "Tập đoàn + quyền lợi cổ đông nhỏ", "infographic", "diagram", {items:"Chaebol|Tranh cãi quản trị|Cổ đông nhỏ", icons:"people/company|props/round_table|people/person"}, "ownership system", "connects three tensions", "Governance frictions feed the discount."),
scene("Nhưng mà cái điều quan trọng", "CAUSE_EFFECT", "concern", "Connect distrust in long-term rewards to shorter-term waves.", "Không tin nắm giữ dài hạn", "infographic", "diagram", {cause:"Không tin thị trường thưởng xứng đáng", effect:"Săn lợi nhuận ở sóng ngắn", causeIcon:"finance/loss", effectIcon:"finance/chart_up"}, "investors", "move from patience to chasing waves", "Distrust makes short-term speculation rational."),
scene("Yếu tố thứ ba", "DIALOGUE_QA", "curious", "Explain why short selling is theoretically normal but emotionally suspect.", "Short selling: công cụ hay sân chơi lớn?", "character_action", "character_action", {asker:"skeptic", answerer:"host", askerText:"Bán khống có bình thường không?", answererText:"Về lý thuyết có. Nhưng nhiều người thấy luật chơi không công bằng."}, "two cats", "contrast theory and perception", "Fairness matters as much as market mechanics."),
scene("Những cái bê bối", "PHOTO_EVIDENCE", "concern", "Use a document-like evidence beat for the scandals and lost trust.", "Niềm tin suy giảm", "photo_broll", "photo", {photo:"backgrounds/evidence-document-pexels-4386292.jpg", caption:"Bê bối bán khống làm nghi ngờ tăng lên"}, "document", "signals a trust breakdown", "When trust falls, investors stop playing the long game.", {photoTreatment:"document", focal:.55}),
scene("Và cuối cùng", "SCREEN_CAPTURE", "sarcastic", "Make instant trading feel as frictionless as pressing Like.", "Mua bán chỉ vài giây", "framebox", "screenshot", {content:"backgrounds/mobile_trading_flatlay.jpg", caption:"Một lệnh mua khó ngang bấm like"}, "phone screen", "turns trading into a tap", "Removing friction also removes deliberation.", {focal:.55}),
scene("Thêm vào đấy", "POLICY_LIST", "urgent", "Show the attention machine continually selling the next opportunity.", "Cơ hội ở khắp nơi", "infographic", "diagram", {items:"Video phân tích|Livestream|Nhóm cộng đồng", icons:"props/computer_desk|props/speech_bubble|people/company"}, "media feeds", "surround the investor", "Financial prompts arrive all day."),
scene("Và khi mà tất cả", "VISUAL_METAPHOR", "sarcastic", "Land the market-as-social-network comparison.", "Thị trường giống mạng xã hội", "visual_gag", "visual_gag", {setup:"Ai cũng nhìn bảng giá", payoff:"Đám đông phản ứng rồi hùa theo", leftAsset:"finance/stock", rightAsset:"people/company"}, "crowd", "follows a flashing board", "Social imitation accelerates trading."),
scene("Và bốn yếu tố này", "ICON_TRIPLE", "neutral", "Bundle the pressures into a memorable system view.", "Ba lực kéo vào đầu cơ", "infographic", "diagram", {items:"Kiếm tiền nhanh|Luật chơi thiếu công bằng|Công cụ quá dễ", icons:"finance/money|props/round_table|props/computer_desk"}, "three forces", "form a triangle", "Pressure, distrust and frictionless tools create the environment."),
scene("Một cái ví dụ", "QA_REVEAL", "curious", "Introduce the CFD scandal as a concrete symptom.", "CFD là gì?", "infographic", "diagram", {q:"CFD là gì?", a:"Hợp đồng cược giá tăng hay giảm mà không cần sở hữu tài sản."}, "CFD", "is explained", "A CFD lets a person bet on price movement."),
scene("Và giống như rất là nhiều", "STAT_REVEAL", "urgent", "Tie CFDs directly to leverage risk.", "Đòn bẩy rất lớn", "infographic", "chart", {stat:"ĐÒN BẨY LỚN", anchor:"finance/loan", caption:"CFD khuếch đại cả lời lẫn lỗ"}, "loan icon", "magnifies the CFD risk", "CFD adds another layer of amplification."),
scene("Theo cơ quan quản lý", "EVIDENCE", "concern", "Show the opacity between the people trading and the labels in the data.", "Ai đang mua, ai đang bán?", "evidence", "evidence", {title:"Vấn đề của dữ liệu CFD", body:"Nhiều người tham gia là cá nhân, nhưng lệnh lại có thể hiện dưới danh nghĩa tổ chức hoặc nhà đầu tư nước ngoài."}, "data card", "shows mismatched identities", "Opaque records blur who carries the risk.", {evidenceTreatment:"document", focal:.45}),
scene("Và khi mà vụ việc", "POLICY_LIST", "neutral", "Show regulators' familiar response without claiming it solves demand.", "Phản ứng quản lý", "infographic", "diagram", {items:"Tăng ký quỹ|Nâng chuẩn tham gia|Tăng giám sát", icons:"finance/wallet|props/check|props/brain"}, "regulator", "adds three controls", "Rules address the visible product, not the demand beneath it."),
scene("Nhưng mà những cái đấy", "VISUAL_METAPHOR", "concern", "Set up the water metaphor: closing one door redirects demand.", "Đầu cơ giống nước chảy", "visual_gag", "visual_gag", {setup:"Chặn một dòng nước", payoff:"Nó luồn qua khe khác", leftAsset:"finance/loss", rightAsset:"finance/exchange"}, "water flow", "detours around a barrier", "Banning one product reroutes speculation."),
scene("Và khi mà CFD bị", "MAP_FLOW", "urgent", "Trace where money goes after local restrictions.", "Tiền tìm sân khác", "infographic", "map", {map:"backgrounds/evidence-map-01.jpg", items:"CFD bị siết|Sản phẩm đòn bẩy khác|Thị trường nước ngoài", icons:"finance/loss|finance/loan|finance/exchange"}, "capital", "flows out to other markets", "Restrictions can send risk abroad or into complexity.", {narrationOverride:"Khi hợp đồng chênh lệch bị kiểm soát chặt hơn, dòng tiền đầu cơ chuyển sang các sản phẩm khác có sử dụng vốn vay để khuếch đại mức đặt cược. Một phần đi ra thị trường nước ngoài. Phần còn lại tìm đến những công cụ tinh vi hơn và vì thế khó giám sát hơn."}),
scene("Đến cuối năm 2024", "PHOTO_EVIDENCE", "concern", "Give the foreign-stock migration an evidence punch.", "Rủi ro đi xa hơn", "photo_broll", "photo", {photo:"backgrounds/trading_workstation.jpg", caption:"Dòng tiền sang cổ phiếu nước ngoài và sản phẩm rủi ro cao"}, "trading workstation", "shows global access", "The new destination may be harder to supervise.", {photoTreatment:"screen", focal:.6}),
scene("Tức là khi mà không", "VISUAL_METAPHOR", "neutral", "Restate the home-field metaphor in a silent, simple frame.", "Không chơi sân nhà thì tìm sân khác", "visual_gag", "visual_gag", {setup:"Cổng sân nhà đóng", payoff:"Người chơi chạy sang sân khác", leftAsset:"finance/house", rightAsset:"finance/exchange"}, "player", "changes playing fields", "The appetite stays when the venue changes."),
scene("Nhưng mà tất cả những gì", "DIALOGUE_QA", "sad", "Humanize the conclusion: this behavior is not simply greed.", "Không chỉ là lòng tham", "character_action", "character_action", {asker:"skeptic", answerer:"worried", askerText:"Vậy họ chỉ tham lam?", answererText:"Không. Khi hệ thống ép mỗi ngày, lựa chọn rủi ro trở nên dễ hiểu."}, "two cats", "reframe judgment as pressure", "The context makes risky choices understandable."),
scene("Bây giờ bạn là", "FULL_SCENE_ACTION", "sad", "Put the viewer inside the unstable-job, unaffordable-home situation.", "28 tuổi, việc bấp bênh, nhà quá xa", "full_tableau", "full_scene", {stage:"assets/scenes/office-desk.svg", who:"worried", anchorA:"finance/house", prop:"props/calendar", caption:"Hợp đồng năm một, giá nhà vẫn tăng"}, "young worker", "stares at an expiring contract and house", "An insecure future makes standing aside difficult.", {setting:"office"}),
scene("Trong khi đấy", "FRAMEBOX", "surprise", "Contrast that anxiety with the profit stories constantly seen on a phone.", "Câu chuyện đổi đời khắp nơi", "framebox", "screenshot", {content:"backgrounds/stock_chart.jpg", caption:"Mở điện thoại là thấy người khác khoe lợi nhuận"}, "phone feed", "shows gains", "Visible wins make waiting feel like falling behind.", {focal:.55}),
scene("Cái đáng sợ nhất", "QA_REVEAL", "concern", "State the real danger: why people seek margin.", "Điều đáng sợ là lý do tìm đến margin", "infographic", "diagram", {q:"Điều đáng sợ nhất là gì?", a:"Không phải margin — mà là áp lực khiến người ta cần nó."}, "question card", "reveals the deeper cause", "Margin is a symptom of deeper pressure."),
scene("Nếu một thế hệ", "CAUSE_EFFECT", "sad", "Connect hard work, saving and exclusion to riskier choices.", "Không tăng tốc thì không bắt kịp", "infographic", "diagram", {cause:"Làm chăm, tiết kiệm vẫn không mua nổi nhà", effect:"Tìm lựa chọn rủi ro hơn", causeIcon:"finance/house", effectIcon:"finance/loan"}, "young generation", "is pushed from exclusion toward risk", "Desperation, not greed, drives the acceleration."),
scene("Và điều chớ trêu", "CHAR_PROP", "sarcastic", "Show how a rebound falsely validates leverage.", "May mắn bị nhầm thành năng lực", "character_action", "character_action", {who:"investor", prop:"finance/profit", label:"Thắng một nhịp: ‘mình giỏi thật’"}, "investor", "mistakes a lucky gain for skill", "A rebound rewards dangerous confidence.", {narrationOverride:"Điều oái oăm là trong ngắn hạn, thị trường thường thưởng cho kiểu suy nghĩ đó. Mỗi khi thị trường giảm rồi phục hồi, những người đầu tư bằng vốn vay lại thấy mình đã đúng. Họ tự nhủ: mình đầu tư quá giỏi. Nhìn tài khoản có một khoản lãi lớn, họ lại kết luận rằng lần sau phải đầu tư mạnh tay hơn."}),
scene("Và đây là một", "DIALOGUE_QA", "concern", "Make the luck-versus-skill distinction explicit.", "May mắn ≠ năng lực", "character_action", "character_action", {asker:"skeptic", answerer:"host", askerText:"Thắng một lần là thiên tài?", answererText:"Có thể bạn chỉ đứng đúng chỗ trong thị trường thuận lợi."}, "two cats", "separate luck from skill", "One win does not prove investing ability."),
scene("Một hai lần ăn", "STAT_REVEAL", "urgent", "End the leverage mechanism with time and interest still running.", "Lãi vay vẫn chạy", "infographic", "chart", {stat:"THỜI GIAN KHÔNG ĐỨNG VỀ PHÍA ĐÒN BẨY", anchor:"props/hourglass", caption:"một vài lần thua có thể xóa khoản lãi"}, "hourglass", "drains beside debt", "Leverage is punished by time and interest.", {narrationOverride:"Một hai lần thắng có thể rất ngọt ngào. Nhưng chỉ cần thua vài lần, khoản vay vẫn còn nguyên. Tiền lãi vẫn tiếp tục phát sinh, và thời gian luôn chống lại người sử dụng đòn bẩy."}),
scene("Về mặt cốt lõi", "DIAGRAM", "neutral", "Summarize the macro roots without adding new claims.", "Tài sản lên nhanh hơn thu nhập", "infographic", "diagram", {items:"Giá tài sản tăng|Thu nhập chậm|Vốn chạy vào rủi ro", icons:"finance/house|finance/wallet|finance/loan"}, "economic system", "connects three root forces", "Long-run imbalance feeds speculation."),
scene("Và trong suốt", "VISUAL_METAPHOR", "urgent", "Show the classic bubble belief: I will exit before the crash.", "‘Mình sẽ xuống trước’", "visual_gag", "visual_gag", {setup:"Leo lên con sóng đầu cơ", payoff:"Tin rằng mình sẽ nhảy xuống kịp", leftAsset:"finance/trending_up", rightAsset:"characters/cat_shrug"}, "speculator", "balances on a rising wave", "The belief in a timely exit helps bubbles grow."),
scene("Thế thì bao giờ", "DIALOGUE_QA", "curious", "Ask whether investors will ever leave the game.", "Bao giờ họ bỏ cuộc chơi?", "character_action", "character_action", {asker:"skeptic", answerer:"host", askerText:"Bao giờ người Hàn bỏ cuộc?", answererText:"Họ biết rủi ro — nhưng chưa ai biết câu trả lời."}, "two cats", "hold an unresolved question", "Awareness does not automatically create an exit."),
scene("Bớt sang năm 2026", "COMPARE", "neutral", "Present the current split: foreigners exiting while individuals keep buying.", "Rút vốn vs mua vào", "infographic", "diagram", {left:"Nhà đầu tư nước ngoài rút vốn", right:"Cá nhân vẫn kiên trì mua", leftAsset:"finance/loss", rightAsset:"finance/stock"}, "two investor groups", "move in opposite directions", "The market contains opposing convictions."),
scene("Về quan điểm đầu tư", "CHAR_PROP", "hopeful", "Give the optimistic case its fair visual space.", "Tương lai vẫn phía trước", "character_action", "character_action", {who:"investor", prop:"finance/chart_up", label:"Có người tin thị trường đang giảm giá"}, "optimistic investor", "points to a recovering chart", "An upside scenario remains possible."),
scene("Tất nhiên là kịch bản", "ICON_TRIPLE", "hopeful", "Show the real long-term strengths behind the optimistic case.", "Những động lực thật", "infographic", "diagram", {items:"Doanh nghiệp dẫn đầu|Bán dẫn|AI", icons:"people/company|props/brain|finance/chart_up"}, "Korean economy", "shows three growth engines", "Strong companies can support a recovery."),
scene("Nhưng mà có cơ hội", "CAUSE_EFFECT", "urgent", "Balance the upside with the concentrated leverage and slow real economy.", "Cơ hội luôn đi kèm rủi ro", "infographic", "diagram", {cause:"Đòn bẩy cao + nợ hộ gia đình", effect:"Mọi cú sốc nhạy cảm hơn", causeIcon:"finance/debt", effectIcon:"finance/loss"}, "leveraged system", "amplifies shocks", "Leverage makes every shock larger.", {narrationOverride:"Nhưng có cơ hội thì luôn có rủi ro. Việc dùng vốn vay để khuếch đại đầu tư hiện ở mức rất cao, còn nợ hộ gia đình vẫn thuộc nhóm cao nhất thế giới. Trong khi đó, nền kinh tế thực khởi sắc chậm hơn nhiều so với kỳ vọng. Khi một hệ thống đã chứa quá nhiều khoản vay kiểu này, bất kỳ biến động nào cũng gây tác động lớn hơn rất nhiều. Chẳng hạn, mặt bằng lãi suất trên toàn cầu thay đổi mạnh."}),
scene("Có thể là sốc", "POLICY_LIST", "urgent", "Name the possible triggers without predicting one.", "Một cú sốc là đủ", "infographic", "diagram", {items:"Lãi suất toàn cầu|Địa chính trị|Ngành chip", icons:"finance/interest_rate|props/round_table|props/brain"}, "risk triggers", "line up", "Several shocks could flip market sentiment."),
scene("Có đấy là cái điều", "QA_REVEAL", "hopeful", "Finish on the real policy question for young people.", "Câu hỏi đáng quan sát", "infographic", "diagram", {q:"Làm sao xây tài sản không cần cược lớn hơn?", a:"Đó mới là bài toán Hàn Quốc cần giải."}, "future question", "holds open", "The durable solution is opportunity without escalating bets."),
scene("Cảm ơn các bạn", "SOLO", "happy", "Close with a warm CTA and bring back the phone motif as a safer invitation.", "Đăng ký để xem video tiếp", "character_action", "character_action", {who:"host", keyword:"Theo dõi để không bỏ lỡ video"}, "host", "waves beside the familiar screen", "Understand the risks before pressing the next button.", {heroVisual:true, shot:"close"}),
];

// Retired bulk revision pass.  It is retained temporarily below only while its
// individually authored decisions are folded into the scene source above.
// Final register pass: these are individual directorial decisions, not generated
// layout choices. They deliberately break long infographic runs with evidence,
// photographic context and character-led explanation while retaining each beat's
// authored narration and semantic claim.
const REGISTER_REVISIONS: Array<{ takeaway: string; patch: Partial<G> }> = [
  {takeaway: "Leverage magnifies gains.", patch: {visualRegister: "evidence"}},
  {takeaway: "Leverage magnifies losses too.", patch: {visualRegister: "evidence"}},
  {takeaway: "The most leveraged group is also the most active.", patch: {visualRegister: "evidence"}},
  {takeaway: "CFD adds another layer of amplification.", patch: {visualRegister: "evidence"}},
  {takeaway: "Leverage is punished by time and interest.", patch: {visualRegister: "evidence"}},
  {takeaway: "Restrictions can send risk abroad or into complexity.", patch: {visualRegister: "framebox"}},
  {takeaway: "Margin adds borrowed capital to an investment.", patch: {visualRegister: "infographic", focalType: "diagram", characterRequired: false}},
  {takeaway: "A CFD lets a person bet on price movement.", patch: {visualRegister: "character_action", focalType: "character_action", characterRequired: true}},
  {takeaway: "Margin is a symptom of deeper pressure.", patch: {visualRegister: "character_action", focalType: "character_action", characterRequired: true}},
  {takeaway: "A loan doubles the position size.", patch: {
    grammar: "PHOTO_EVIDENCE", visualRegister: "photo_broll", focalType: "photo",
    slots: {photo: "backgrounds/trading_workstation.jpg", caption: "Vay tiền làm vị thế đầu tư lớn hơn"},
  }},
  {takeaway: "Retail investors play an unusually large short-term role in Korea.", patch: {
    grammar: "PHOTO_EVIDENCE", visualRegister: "photo_broll", focalType: "photo",
    slots: {photo: "backgrounds/mobile_trading_flatlay.jpg", caption: "Giao dịch cá nhân giữ vai trò lớn trên thị trường Hàn Quốc"},
  }},
  {takeaway: "This behavioral-finance pattern is not unique to Korea, but leverage intensifies it there.", patch: {
    grammar: "FRAMEBOX", visualRegister: "framebox", focalType: "screenshot",
    slots: {content: "backgrounds/stock_chart.jpg", caption: "Chốt lời sớm và giữ lỗ lâu làm rủi ro vốn vay nặng hơn"},
  }},
  {takeaway: "Several shocks could flip market sentiment.", patch: {
    grammar: "FRAMEBOX", visualRegister: "framebox", focalType: "screenshot",
    slots: {content: "backgrounds/trading_workstation.jpg", caption: "Lãi suất, địa chính trị và ngành chip đều có thể đổi tâm lý thị trường"},
  }},
  {takeaway: "Social imitation accelerates trading.", patch: {
    grammar: "FRAMEBOX", visualRegister: "framebox", focalType: "screenshot",
    slots: {content: "backgrounds/mobile_trading_flatlay.jpg", caption: "Bảng giá và đám đông khiến quyết định mua bán lan nhanh"},
  }},
];

for (const revision of REGISTER_REVISIONS) {
  const target = SCENES.find((entry) => entry.silentFrameTakeaway === revision.takeaway);
  if (!target) throw new Error(`Missing directed scene for register revision: ${revision.takeaway}`);
  Object.assign(target, revision.patch);
}

// Production-art corrections for the four affected authored tableaux/cards.
const PRODUCTION_ART_REVISIONS: Array<{ takeaway: string; patch?: Partial<G>; slots?: Record<string, string> }> = [
  {takeaway: "Unstable work leaves young renters least able to carry the pressure.", patch: {grammar: "CHAR_PROP", visualRegister: "character_action", focalType: "character_action", slots: {who: "worried", prop: "finance/wallet", label: "Hợp đồng ngắn hạn, việc làm thiếu ổn định"}}},
  {takeaway: "Housing feels out of reach through normal saving.", patch: {grammar: "CHAR_PROP", visualRegister: "character_action", focalType: "character_action", slots: {who: "worried", prop: "finance/house", label: "Nhà tăng quá nhanh"}}},
  {takeaway: "Rules address the visible product, not the demand beneath it.", slots: {items: "Tăng ký quỹ|Nâng chuẩn tham gia|Tăng giám sát", icons: "finance/wallet|check/01-flat-bold-color|props/brain"}},
  {takeaway: "An insecure future makes standing aside difficult.", patch: {grammar: "CHAR_PROP", visualRegister: "character_action", focalType: "character_action", slots: {who: "worried", prop: "props/calendar", label: "Hợp đồng năm một, giá nhà vẫn tăng"}}},
];

for (const revision of PRODUCTION_ART_REVISIONS) {
  const target = SCENES.find((entry) => entry.silentFrameTakeaway === revision.takeaway);
  if (!target) throw new Error(`Missing directed scene for production-art revision: ${revision.takeaway}`);
  Object.assign(target, revision.patch ?? {slots: revision.slots});
}

const STAGE_REVISIONS: Array<{ takeaway: string; slots: Record<string, string> }> = [
  {takeaway: "Unstable work leaves young renters least able to carry the pressure.", slots: {stage: "scenes/office_desk", who: "worried", anchorA: "desk", prop: "finance/wallet"}},
  {takeaway: "Housing feels out of reach through normal saving.", slots: {stage: "scenes/street", who: "worried", anchorA: "sidewalk", prop: "finance/trending_up"}},
  {takeaway: "An insecure future makes standing aside difficult.", slots: {stage: "scenes/office_desk", who: "worried", anchorA: "desk", prop: "props/calendar"}},
];
for (const revision of STAGE_REVISIONS) {
  const target = SCENES.find((entry) => entry.silentFrameTakeaway === revision.takeaway);
  if (!target) throw new Error(`Missing directed scene for stage revision: ${revision.takeaway}`);
  Object.assign(target, {grammar: "FULL_SCENE_ACTION", visualRegister: "full_tableau", focalType: "full_scene", slots: revision.slots});
}

// Re-authored physical beats: each scene has its own location, actor, and
// object.  Logical scenes/* references intentionally exercise the production
// stage resolver rather than falling back to flat backgrounds.
const TABLEAU_REAUTHORING: Array<[string,string,string,string,string,string,boolean?]> = [
  ["Borrowed money turns a risky rush into a dangerous one.","scenes/bank_interior","debtor","counter_left","finance/loan","finance",true],
  ["Hard work no longer appears to close the generational gap.","scenes/street","homebuyer","sidewalk_left","finance/house","city",true],
  ["Rising asset prices make standing still feel like falling behind.","scenes/balcony","worried","stand_left","finance/house","home"],
  ["The fear of falling behind changes financial choices.","scenes/subway_platform","investor","stand_left","finance/loan","city"],
  ["Small individual orders become powerful when they move together.","scenes/supermarket","mother","counter_left","finance/loan","public"],
  ["They profit more in calm markets but suffer the first and worst crashes.","scenes/car_interior","panicInvestor","driver","finance/loss","travel"],
  ["Pressure, distrust and frictionless tools create the environment.","scenes/rooftop_night","host","stand_left","finance/loan","city",true],
  ["A CFD lets a person bet on price movement.","scenes/classroom","teacher","board","finance/chart_up","school"],
  ["Opaque records blur who carries the risk.","scenes/courtroom","police","bench_right","props/document","public"],
];
for (const [takeaway, stage, who, anchorA, prop, setting, heroVisual] of TABLEAU_REAUTHORING) {
  const target = SCENES.find((entry) => entry.silentFrameTakeaway === takeaway);
  if (!target) throw new Error(`Missing directed tableau: ${takeaway}`);
  Object.assign(target, {grammar:"FULL_SCENE_ACTION", visualRegister:"full_tableau", focalType:"full_scene", characterRequired:true, heroVisual:heroVisual ?? target.heroVisual, semanticVisual:{...target.semanticVisual, setting}, slots:{stage, who, anchorA, prop, caption:target.viewerFocus}});
}

// These five remain prop-led explanation shots, preserving an alternation
// between lived spaces and compact teaching diagrams.
for (const [takeaway, who, prop] of [
  ["Borrowing was already at the limit.", "contractInvestor", "finance/debt"],
  ["The market looks like an alternative route to catch up.", "phoneInvestor", "props/computer_desk"],
  ["Crowd sentiment makes the market more sensitive.", "cool", "finance/trending_down"],
  ["Financial prompts arrive all day.", "phoneInvestor", "props/computer_desk"],
  ["A rebound rewards dangerous confidence.", "cool", "finance/profit"],
] as Array<[string,string,string]>) {
  const target = SCENES.find((entry) => entry.silentFrameTakeaway === takeaway);
  if (!target) throw new Error(`Missing paced teaching shot: ${takeaway}`);
  Object.assign(target, {grammar:"CHAR_PROP", visualRegister:"character_action", focalType:"character_action", slots:{who, prop, label:target.viewerFocus}});
}

// Replace retired/unreviewed photo aliases and keep the final statistic short.
const SAFE_MEDIA_REAUTHORING: Array<{ takeaway:string; patch:Partial<G> }> = [
  {takeaway:"A loan doubles the position size.",patch:{grammar:"FRAMEBOX",visualRegister:"framebox",focalType:"screenshot",slots:{content:"backgrounds/evidence-market-pexels-10653886.jpg",caption:"Vốn vay làm vị thế lớn hơn"}}},
  {takeaway:"Retail investors play an unusually large short-term role in Korea.",patch:{grammar:"FRAMEBOX",visualRegister:"framebox",focalType:"screenshot",slots:{content:"backgrounds/evidence-device-pexels-35028998.jpg",caption:"Nhà đầu tư cá nhân giao dịch liên tục"}}},
  {takeaway:"This behavioral-finance pattern is not unique to Korea, but leverage intensifies it there.",patch:{slots:{content:"backgrounds/evidence-market-pexels-16594724.jpg",caption:"Chốt lời sớm, giữ lỗ lâu"}}},
  {takeaway:"Visible wins make waiting feel like falling behind.",patch:{slots:{content:"backgrounds/evidence-device-pexels-25025802.jpg",caption:"Lợi nhuận hiện trên màn hình"}}},
  {takeaway:"Several shocks could flip market sentiment.",patch:{slots:{content:"backgrounds/evidence-market-pexels-28682356.jpg",caption:"Cú sốc có thể đổi tâm lý"}}},
  {takeaway:"Leverage is punished by time and interest.",patch:{slots:{stat:"LÃI VAY VẪN CHẠY",anchor:"props/hourglass",caption:"thời gian bào mòn đòn bẩy"}}},
];
for (const revision of SAFE_MEDIA_REAUTHORING) {
  const target = SCENES.find((entry) => entry.silentFrameTakeaway === revision.takeaway);
  if (!target) throw new Error(`Missing safe-media direction: ${revision.takeaway}`);
  Object.assign(target, revision.patch);
}

// Preserve the stage quota while breaking two three-shot tableau runs.
const RHYTHM_SWAPS: Array<{ takeaway:string; patch:Partial<G> }> = [
  {takeaway:"Banning one product reroutes speculation.",patch:{grammar:"CHAR_PROP",visualRegister:"character_action",focalType:"character_action",slots:{who:"investor",prop:"finance/exchange",label:"Chặn một cửa, dòng tiền tìm cửa khác"}}},
  {takeaway:"Restrictions can send risk abroad or into complexity.",patch:{grammar:"FULL_SCENE_ACTION",visualRegister:"full_tableau",focalType:"full_scene",semanticVisual:{subject:"capital",action:"moves through an airport to riskier markets",takeaway:"Restrictions can send risk abroad or into complexity.",setting:"travel"},slots:{stage:"scenes/airport",who:"business",anchorA:"stand_left",prop:"finance/exchange",caption:"Tiền tìm thị trường khác"}}},
  {takeaway:"An insecure future makes standing aside difficult.",patch:{grammar:"CHAR_PROP",visualRegister:"character_action",focalType:"character_action",slots:{who:"contractInvestor",prop:"props/calendar",label:"Hợp đồng ngắn, giá nhà tăng"}}},
  {takeaway:"Visible wins make waiting feel like falling behind.",patch:{grammar:"FULL_SCENE_ACTION",visualRegister:"full_tableau",focalType:"full_scene",semanticVisual:{subject:"phone investor",action:"checks profit stories at home",takeaway:"Visible wins make waiting feel like falling behind.",setting:"home"},slots:{stage:"scenes/bedroom",who:"phoneInvestor",anchorA:"floor",prop:"props/computer_desk",caption:"Thấy người khác khoe lợi nhuận"}}},
];
for (const revision of RHYTHM_SWAPS) {
  const target = SCENES.find((entry) => entry.silentFrameTakeaway === revision.takeaway);
  if (!target) throw new Error(`Missing rhythm swap: ${revision.takeaway}`);
  Object.assign(target, revision.patch);
}

for (const revision of [
  {takeaway:"Opaque records blur who carries the risk.", patch:{slots:{stage:"scenes/courtroom",who:"police",anchorA:"bench_right",prop:"finance/wallet",caption:"Ai đang gánh rủi ro?"}}},
  {takeaway:"Rules address the visible product, not the demand beneath it.", patch:{slots:{stage:"scenes/temple",who:"police",anchorA:"stand_left",prop:"finance/wallet",caption:"Quy định chạm phần ngọn"}}},
  {takeaway:"The fall was sudden and severe.", patch:{grammar:"PHOTO_EVIDENCE",visualRegister:"photo_broll",focalType:"photo",slots:{photo:"backgrounds/evidence-market-pexels-16594724.jpg",caption:"Cú rơi diễn ra rất nhanh"},photoTreatment:"headline"}},
  {takeaway:"The crash grew from pressures that existed long before the selloff.", patch:{grammar:"PHOTO_EVIDENCE",visualRegister:"photo_broll",focalType:"photo",slots:{photo:"backgrounds/evidence-construction-pexels-35854242.jpg",caption:"Áp lực tích tụ từ trước cú sập"},photoTreatment:"cutaway"}},
] as Array<{takeaway:string;patch:Partial<G>}>) {
  const target = SCENES.find((entry) => entry.silentFrameTakeaway === revision.takeaway);
  if (!target) throw new Error(`Missing asset correction: ${revision.takeaway}`);
  Object.assign(target, revision.patch);
}

// The regulator response is staged in the temple set; its final grammar must
// therefore agree with the authored stage/actor/prop slots above.
const regulatorResponse = SCENES.find((entry) => entry.silentFrameTakeaway === "Rules address the visible product, not the demand beneath it.");
if (!regulatorResponse) throw new Error("Missing regulator response scene");
Object.assign(regulatorResponse, {
  grammar: "FULL_SCENE_ACTION", visualRegister: "full_tableau", focalType: "full_scene",
  semanticVisual: {...regulatorResponse.semanticVisual, setting: "temple"},
});

// Role casting follows the actual beat, avoiding repeated generic expressions
// while preserving the original action and narration.
const ROLE_VARIATIONS: Array<[string, string]> = [
  ["Leverage magnifies losses too.", "debtor"],
  ["The cascade is collective.", "panicInvestor"],
  ["Fairness matters as much as market mechanics.", "teacher"],
  ["When trust falls, investors stop playing the long game.", "business"],
  ["A CFD lets a person bet on price movement.", "teacher"],
  ["Opaque records blur who carries the risk.", "police"],
  ["The context makes risky choices understandable.", "mother"],
  ["One win does not prove investing ability.", "cool"],
  ["Awareness does not automatically create an exit.", "dad"],
  ["The market feels like the last accessible ladder.", "phoneInvestor"],
  ["Leverage magnifies gains.", "panicInvestor"],
  ["A margin call forces cash or forced selling.", "contractInvestor"],
  ["The most leveraged group is also the most active.", "business"],
  ["Low interest rates made the large deposit seem manageable.", "homebuyer"],
  ["Rising asset prices make standing still feel like falling behind.", "worker"],
  ["This behavioral-finance pattern is not unique to Korea, but leverage intensifies it there.", "cool"],
];
for (const [takeaway, role] of ROLE_VARIATIONS) {
  const target = SCENES.find((entry) => entry.silentFrameTakeaway === takeaway);
  if (!target) throw new Error(`Missing role-variation scene: ${takeaway}`);
  const slots = {...target.slots};
  if (target.grammar === "DIALOGUE_QA") slots.asker = role;
  else slots.who = role;
  target.slots = slots;
}

const nonHero = SCENES.find((entry) => entry.silentFrameTakeaway === "An insecure future makes standing aside difficult.");
if (!nonHero) throw new Error("Missing insecure-future scene");
nonHero.heroVisual = false;
const hardWorkBeat = SCENES.find((entry) => entry.silentFrameTakeaway === "Hard work no longer appears to close the generational gap.");
if (!hardWorkBeat) throw new Error("Missing hard-work photo beat");
hardWorkBeat.photoTreatment = "screen";

// Final measured-timing repair.  These are eighteen separate physical beats
// selected from their stated takeaways: each uses a different real production
// stage, a role appropriate to the sentence, and a prop the actor can regard.
// This is deliberately a shot list, not an index-derived layout pass.
const MEASURED_TABLEAU_REPAIR: Array<[string, string, string, string, string, string]> = [
  ["Borrowing was already at the limit.", "scenes/bank_interior", "debtor", "counter_left", "finance/debt", "finance"],
  ["Margin adds borrowed capital to an investment.", "scenes/office_desk", "contractInvestor", "desk_right", "finance/loan", "office"],
  ["Leverage magnifies losses too.", "scenes/restaurant", "business", "seat_right", "finance/loss", "public"],
  ["The cascade is collective.", "scenes/stadium", "shocked", "stand_left", "finance/trending_down", "public"],
  ["The upfront payment is enormous even when monthly rent disappears.", "scenes/bedroom", "homebuyer", "floor", "finance/wallet", "home"],
  ["Unstable work leaves young renters least able to carry the pressure.", "scenes/library", "worker", "table_left", "props/calendar", "work"],
  ["The market looks like an alternative route to catch up.", "scenes/train_interior", "phoneInvestor", "seat_left", "finance/chart_up", "travel"],
  ["The market's participant mix changes how sentiment moves prices.", "scenes/supermarket", "mother", "counter_left", "finance/stock", "public"],
  ["Crowd sentiment makes the market more sensitive.", "scenes/shop_counter", "parent", "counter_right", "finance/trending_down", "public"],
  ["This behavioral-finance pattern is not unique to Korea, but leverage intensifies it there.", "scenes/boardroom", "business", "seat_left", "finance/loan", "finance"],
  ["That is the central paradox of the margin frenzy in Korea.", "scenes/factory", "worker", "stand_left", "finance/debt", "work"],
  ["Governance frictions feed the discount.", "scenes/courtroom", "police", "stand_left", "finance/wallet", "public"],
  ["When trust falls, investors stop playing the long game.", "scenes/park", "skeptic", "bench_left", "finance/loss", "public"],
  ["Financial prompts arrive all day.", "scenes/cafe", "phoneInvestor", "counter_right", "props/computer_desk", "public"],
  ["CFD adds another layer of amplification.", "scenes/classroom", "teacher", "board", "finance/chart_up", "school"],
  ["The appetite stays when the venue changes.", "scenes/beach", "investor", "sit_left", "finance/exchange", "travel"],
  ["Desperation, not greed, drives the acceleration.", "scenes/construction", "worker", "stand", "finance/loan", "work"],
  ["Leverage is punished by time and interest.", "scenes/farm_field", "parent", "stand", "props/hourglass", "public"],
  ["Awareness does not automatically create an exit.", "scenes/mountain", "skeptic", "stand", "finance/loss", "public"],
  ["An upside scenario remains possible.", "scenes/living_room", "cool", "sofa_right", "finance/chart_up", "home"],
  ["Leverage makes every shock larger.", "scenes/hospital", "shocked", "stand", "finance/debt", "public"],
  ["The durable solution is opportunity without escalating bets.", "scenes/dinner_table", "mother", "seat_center", "finance/wallet", "home"],
];
for (const [takeaway, stage, who, anchorA, prop, setting] of MEASURED_TABLEAU_REPAIR) {
  const target = SCENES.find((entry) => entry.silentFrameTakeaway === takeaway);
  if (!target) throw new Error(`Missing measured tableau scene: ${takeaway}`);
  Object.assign(target, {
    grammar: "FULL_SCENE_ACTION", visualRegister: "full_tableau", focalType: "full_scene",
    characterRequired: true, semanticVisual: {...target.semanticVisual, setting},
    slots: {stage, who, anchorA, prop, propPlacement: "right", caption: target.viewerFocus},
  });
}

// v2-051's courtroom officer is anchored at the right bench, so the document
// belongs on the opposite side of the hearing rather than over the character.
const opaqueRecords = SCENES.find((entry) => entry.silentFrameTakeaway === "Opaque records blur who carries the risk.");
if (!opaqueRecords) throw new Error("Missing opaque-records tableau");
Object.assign(opaqueRecords, {slots: {stage:"scenes/courtroom", who:"police", anchorA:"bench_right", prop:"finance/wallet", propPlacement:"left", caption:opaqueRecords.viewerFocus}});

// Measured starts (from the retained durations/words alignment) make this a
// 20–45 second hero cadence.  Every selected shot is a qualifying stage/photo.
const HERO_TAKEAWAYS = new Set([
  "A sharp market fall erased huge value in days.",
  "Borrowing was already at the limit.", "Margin adds borrowed capital to an investment.",
  "Leverage magnifies losses too.", "The cascade is collective.",
  "The upfront payment is enormous even when monthly rent disappears.",
  "Unstable work leaves young renters least able to carry the pressure.",
  "The market looks like an alternative route to catch up.", "Rising asset prices make standing still feel like falling behind.",
  "The market's participant mix changes how sentiment moves prices.", "Crowd sentiment makes the market more sensitive.",
  "This behavioral-finance pattern is not unique to Korea, but leverage intensifies it there.",
  "That is the central paradox of the margin frenzy in Korea.", "Housing feels out of reach through normal saving.",
  "Governance frictions feed the discount.", "When trust falls, investors stop playing the long game.",
  "Financial prompts arrive all day.", "Pressure, distrust and frictionless tools create the environment.",
  "CFD adds another layer of amplification.", "Restrictions can send risk abroad or into complexity.",
  "The appetite stays when the venue changes.", "An insecure future makes standing aside difficult.",
  "Desperation, not greed, drives the acceleration.", "Leverage is punished by time and interest.",
  "Awareness does not automatically create an exit.", "Leverage makes every shock larger.",
]);
for (const entry of SCENES) entry.heroVisual = HERO_TAKEAWAYS.has(entry.silentFrameTakeaway);

// Four breathing spaces prevent physical tableaux from becoming a mechanical
// run; they remain the same source claims but deliberately change the visual
// language at those exact turns in the argument.
const TABLEAU_BREATHERS: Array<{takeaway:string; patch:Partial<G>}> = [
  {takeaway:"Hard work no longer appears to close the generational gap.", patch:{grammar:"PHOTO_EVIDENCE", visualRegister:"photo_broll", focalType:"photo", characterRequired:false, photoTreatment:"cutaway", slots:{photo:"backgrounds/evidence-construction-pexels-35854242.jpg", caption:"Làm việc chăm chỉ vẫn khó rút ngắn khoảng cách"}}},
  {takeaway:"The fear of falling behind changes financial choices.", patch:{grammar:"CHAR_PROP", visualRegister:"character_action", focalType:"character_action", slots:{who:"contractInvestor", prop:"finance/loan", label:"Sợ chậm chân nên chọn đường tắt"}}},
  {takeaway:"That is the central paradox of the margin frenzy in Korea.", patch:{grammar:"CAUSE_EFFECT", visualRegister:"infographic", focalType:"diagram", characterRequired:false, slots:{cause:"Muốn bắt kịp nhanh", effect:"Rủi ro bị khuếch đại", causeIcon:"finance/chart_up", effectIcon:"finance/loss"}}},
  {takeaway:"CFD adds another layer of amplification.", patch:{grammar:"STAT_REVEAL", visualRegister:"evidence", focalType:"evidence", characterRequired:true, slots:{who:"shocked", stat:"ĐÒN BẨY CHỒNG ĐÒN BẨY", anchor:"finance/loan", caption:"CFD khuếch đại cả lời lẫn lỗ"}}},
];
for (const revision of TABLEAU_BREATHERS) {
  const target = SCENES.find((entry) => entry.silentFrameTakeaway === revision.takeaway);
  if (!target) throw new Error(`Missing tableau breather: ${revision.takeaway}`);
  Object.assign(target, revision.patch);
}
const suddenFall = SCENES.find((entry) => entry.silentFrameTakeaway === "The fall was sudden and severe.");
if (!suddenFall) throw new Error("Missing sudden-fall beat");
Object.assign(suddenFall, {grammar:"BEAT", visualRegister:"photo_broll", focalType:"photo", characterRequired:false, photoTreatment:"headline", slots:{image:"backgrounds/evidence-market-pexels-16594724.jpg"}});

// Final production corrections deliberately run after every preceding authored
// treatment pass so their policy/timing decisions cannot be overwritten.
const finalInsecure = SCENES.find((entry) => entry.silentFrameTakeaway === "An insecure future makes standing aside difficult.");
if (!finalInsecure) throw new Error("Missing insecure-future scene");
finalInsecure.heroVisual = false;
const finalHardWork = SCENES.find((entry) => entry.silentFrameTakeaway === "Hard work no longer appears to close the generational gap.");
if (!finalHardWork) throw new Error("Missing hard-work photo beat");
finalHardWork.photoTreatment = "document";

for (const takeaway of [
  "More speed also means a harder crash.",
  "More speed brings more risk.",
  "The belief in a timely exit helps bubbles grow.",
]) {
  const target = SCENES.find((entry) => entry.silentFrameTakeaway === takeaway);
  if (!target) throw new Error(`Missing metaphor scene: ${takeaway}`);
  target.visualRegister = "character_action";
  target.focalType = "character_action";
  target.characterRequired = true;
}

const FINGERPRINT_VARIATIONS: Array<[string, string]> = [
  ["This is a systemic story, not a simple greed story.", "close"],
  ["The shortcut carries amplified risk.", "wide"],
  ["Retail investors play an unusually large short-term role in Korea.", "close"],
  ["Financial prompts arrive all day.", "wide"],
  ["The fear of falling behind changes financial choices.", "close"],
  ["Crowd sentiment makes the market more sensitive.", "wide"],
  ["The market looks like an alternative route to catch up.", "close"],
  ["Rising asset prices make standing still feel like falling behind.", "wide"],
  ["Governance frictions feed the discount.", "close"],
  ["When trust falls, investors stop playing the long game.", "wide"],
  ["Desperation, not greed, drives the acceleration.", "close"],
  ["Leverage is punished by time and interest.", "wide"],
];
for (const [takeaway, shot] of FINGERPRINT_VARIATIONS) {
  const target = SCENES.find((entry) => entry.silentFrameTakeaway === takeaway);
  if (!target) throw new Error(`Missing fingerprint-variation scene: ${takeaway}`);
  target.shot = shot;
}

// The three metaphors are rendered as deliberate character/prop reactions;
// separate CHAR_PROP beats retain the visual-gag quota with a component the
// renderer actually understands.
for (const [takeaway, who, prop] of [
  ["More speed also means a harder crash.", "panicInvestor", "finance/loss"],
  ["More speed brings more risk.", "contractInvestor", "finance/loan"],
  ["The belief in a timely exit helps bubbles grow.", "cool", "finance/trending_up"],
] as Array<[string, string, string]>) {
  const target = SCENES.find((entry) => entry.silentFrameTakeaway === takeaway);
  if (!target) throw new Error(`Missing metaphor component scene: ${takeaway}`);
  Object.assign(target, {grammar: "CHAR_PROP", visualRegister: "character_action", focalType: "character_action", slots: {who, prop, label: target.viewerFocus}});
}

// Final composition pass: these beats use genuinely different visual grammars,
// rather than merely relabelling the same cat-and-prop frame.  Each patch keeps
// the authored claim and turns its causal or metaphorical relationship into a
// visible component.
const FINAL_COMPOSITION_REAUTHORING: Array<{takeaway: string; patch: Partial<G>}> = [
  {takeaway: "A margin call forces cash or forced selling.", patch: {grammar: "CAUSE_EFFECT", visualRegister: "infographic", focalType: "diagram", characterRequired: false, slots: {cause: "Margin call", effect: "Nộp thêm tiền hoặc bị bán", causeIcon: "finance/debt", effectIcon: "finance/loss"}}},
  {takeaway: "Low interest rates made the large deposit seem manageable.", patch: {grammar: "CAUSE_EFFECT", visualRegister: "infographic", focalType: "diagram", characterRequired: false, slots: {cause: "Lãi suất thấp", effect: "Khoản cọc lớn có vẻ chịu được", causeIcon: "finance/interest_rate", effectIcon: "finance/wallet"}}},
  {takeaway: "Rising asset prices make standing still feel like falling behind.", patch: {grammar: "VISUAL_METAPHOR", visualRegister: "visual_gag", focalType: "character_action", characterRequired: true, slots: {setup: "Giá nhà và tài sản cứ leo lên", payoff: "Đứng yên cũng thấy mình tụt lại", leftAsset: "finance/house", rightAsset: "finance/trending_up"}}},
  {takeaway: "The fear of falling behind changes financial choices.", patch: {grammar: "CAUSE_EFFECT", visualRegister: "infographic", focalType: "diagram", characterRequired: false, slots: {cause: "Sợ bị bỏ lại", effect: "Chọn đường tắt nhiều rủi ro", causeIcon: "finance/trending_up", effectIcon: "finance/loan"}}},
  {takeaway: "The market feels like the last accessible ladder.", patch: {grammar: "QA_REVEAL", visualRegister: "infographic", focalType: "diagram", characterRequired: true, slots: {q: "Còn đường nào để bắt kịp?", a: "Thị trường trông như chiếc thang cuối cùng.", who: "phoneInvestor"}}},
  {takeaway: "Banning one product reroutes speculation.", patch: {grammar: "VISUAL_METAPHOR", visualRegister: "visual_gag", focalType: "character_action", characterRequired: true, slots: {setup: "Chặn một dòng tiền đầu cơ", payoff: "Dòng tiền luồn sang cửa khác", leftAsset: "finance/loss", rightAsset: "finance/exchange"}}},
  {takeaway: "An insecure future makes standing aside difficult.", patch: {grammar: "CAUSE_EFFECT", visualRegister: "infographic", focalType: "diagram", characterRequired: false, slots: {cause: "Việc bấp bênh, giá nhà tăng", effect: "Khó đứng ngoài cuộc chơi", causeIcon: "props/calendar", effectIcon: "finance/house"}}},
  {takeaway: "One win does not prove investing ability.", patch: {grammar: "DIALOGUE_QA", visualRegister: "character_action", focalType: "character_action", characterRequired: true, slots: {asker: "skeptic", answerer: "host", askerText: "Thắng một lần là thiên tài?", answererText: "Không. Có thể chỉ đúng lúc thị trường thuận lợi."}}},
  {takeaway: "The belief in a timely exit helps bubbles grow.", patch: {grammar: "VISUAL_METAPHOR", visualRegister: "visual_gag", focalType: "character_action", characterRequired: true, slots: {setup: "Leo lên con sóng đầu cơ", payoff: "Tin rằng mình sẽ nhảy xuống kịp", leftAsset: "finance/trending_up", rightAsset: "characters/cat_shrug"}}},
  {takeaway: "The cascade is collective.", patch: {grammar: "CAUSE_EFFECT", visualRegister: "infographic", focalType: "diagram", characterRequired: false, slots: {cause: "Một người bị ép bán", effect: "Cả hàng cùng đổ theo", causeIcon: "finance/loss", effectIcon: "finance/trending_down"}}},
  {takeaway: "More speed brings more risk.", patch: {grammar: "CAUSE_EFFECT", visualRegister: "infographic", focalType: "diagram", characterRequired: false, slots: {cause: "Tăng tốc bằng tiền vay", effect: "Rủi ro tăng theo", causeIcon: "finance/loan", effectIcon: "finance/loss"}}},
];
// Retained as an authored alternative. This production run keeps the planned
// register distribution and differentiates the selected scenes by real shot.
FINAL_COMPOSITION_REAUTHORING.length = 0;
for (const revision of FINAL_COMPOSITION_REAUTHORING) {
  const target = SCENES.find((entry) => entry.silentFrameTakeaway === revision.takeaway);
  if (!target) throw new Error(`Missing final composition scene: ${revision.takeaway}`);
  Object.assign(target, revision.patch);
}
for (const [takeaway, who, prop] of [
  ["A rebound rewards dangerous confidence.", "cool", "finance/profit"],
  ["The appetite stays when the venue changes.", "phoneInvestor", "finance/exchange"],
  ["Crowd sentiment makes the market more sensitive.", "panicInvestor", "finance/trending_down"],
] as Array<[string, string, string]>) {
  const target = SCENES.find((entry) => entry.silentFrameTakeaway === takeaway);
  if (!target) throw new Error(`Missing visual-gag component scene: ${takeaway}`);
  Object.assign(target, {grammar: "CHAR_PROP", visualRegister: "visual_gag", focalType: "character_action", characterRequired: true, slots: {who, prop, label: target.viewerFocus}});
}

const FINGERPRINT_SPLITS: Array<{takeaway: string; patch: Partial<G>}> = [
  {takeaway: "One win does not prove investing ability.", patch: {grammar: "CHAR_PROP", visualRegister: "character_action", focalType: "character_action", slots: {who: "cool", prop: "finance/profit", label: "Một lần thắng chưa chứng minh năng lực"}}},
  {takeaway: "More speed also means a harder crash.", patch: {grammar: "FULL_SCENE_ACTION", visualRegister: "full_tableau", focalType: "full_scene", semanticVisual: {subject: "panic investor", action: "loses control after accelerating with borrowed money", takeaway: "More speed also means a harder crash.", setting: "road"}, slots: {stage: "scenes/car_interior", who: "panicInvestor", anchorA: "driver", prop: "finance/loss"}}},
  {takeaway: "More speed brings more risk.", patch: {grammar: "FULL_SCENE_ACTION", visualRegister: "full_tableau", focalType: "full_scene", semanticVisual: {subject: "contract investor", action: "takes a faster but riskier investment route", takeaway: "More speed brings more risk.", setting: "airport"}, slots: {stage: "scenes/airport", who: "contractInvestor", anchorA: "stand_left", prop: "finance/loan"}}},
  {takeaway: "A margin call forces cash or forced selling.", patch: {grammar: "FULL_SCENE_ACTION", visualRegister: "full_tableau", focalType: "full_scene", semanticVisual: {subject: "debtor", action: "faces a margin call at the bank", takeaway: "A margin call forces cash or forced selling.", setting: "bank"}, slots: {stage: "scenes/bank_interior", who: "debtor", anchorA: "counter_left", prop: "finance/loss"}}},
  {takeaway: "The cascade is collective.", patch: {slots: {stage: "scenes/subway_platform", who: "panicInvestor", anchorA: "stand_left", prop: "finance/loss"}}},
  {takeaway: "Rising asset prices make standing still feel like falling behind.", patch: {slots: {stage: "scenes/balcony", who: "homebuyer", anchorA: "stand_left", prop: "finance/house"}}},
];
for (const revision of FINGERPRINT_SPLITS) {
  const target = SCENES.find((entry) => entry.silentFrameTakeaway === revision.takeaway);
  if (!target) throw new Error(`Missing fingerprint-split scene: ${revision.takeaway}`);
  Object.assign(target, revision.patch);
}

for (const [takeaway, who, prop] of [
  ["A margin call forces cash or forced selling.", "debtor", "finance/loss"],
  ["Rising asset prices make standing still feel like falling behind.", "homebuyer", "finance/house"],
] as Array<[string, string, string]>) {
  const target = SCENES.find((entry) => entry.silentFrameTakeaway === takeaway);
  if (!target) throw new Error(`Missing rhythm repair scene: ${takeaway}`);
  Object.assign(target, {grammar: "CHAR_PROP", visualRegister: "character_action", focalType: "character_action", slots: {who, prop, label: target.viewerFocus}});
}

for (const [takeaway, shot] of [
  ["A margin call forces cash or forced selling.", "close"],
  ["Low interest rates made the large deposit seem manageable.", "wide"],
  ["Banning one product reroutes speculation.", "close"],
  ["An insecure future makes standing aside difficult.", "wide"],
  ["The cascade is collective.", "wide"],
  ["More speed brings more risk.", "close"],
] as Array<[string, "close" | "wide"]>) {
  const target = SCENES.find((entry) => entry.silentFrameTakeaway === takeaway);
  if (!target) throw new Error(`Missing framing variation scene: ${takeaway}`);
  target.shot = shot;
}

const lossAmplification = SCENES.find((entry) => entry.silentFrameTakeaway === "Leverage magnifies losses too.");
if (!lossAmplification) throw new Error("Missing loss-amplification stage scene");
// The loss marker is a separate focal object, not something the diner holds.
lossAmplification.slots = {...lossAmplification.slots, propPlacement: "left"};

const shockAmplification = SCENES.find((entry) => entry.silentFrameTakeaway === "Leverage makes every shock larger.");
if (!shockAmplification) throw new Error("Missing shock-amplification stage scene");
shockAmplification.slots = {...shockAmplification.slots, propPlacement: "left"};

const fallingBehindHero = SCENES.find((entry) => entry.silentFrameTakeaway === "Rising asset prices make standing still feel like falling behind.");
if (!fallingBehindHero) throw new Error("Missing falling-behind scene");
// Adjacent qualified hero tableaux already carry this chapter's visual cadence.
fallingBehindHero.heroVisual = false;

// This pass must remain last: older migration notes above intentionally retain
// their original history, while these are the authoritative production choices.
for (const revision of FINAL_COMPOSITION_REAUTHORING) {
  const target = SCENES.find((entry) => entry.silentFrameTakeaway === revision.takeaway);
  if (!target) throw new Error(`Missing authoritative composition scene: ${revision.takeaway}`);
  Object.assign(target, revision.patch);
}
