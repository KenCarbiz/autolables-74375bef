import { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useAudit } from "@/contexts/AuditContext";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { resolveBuyersGuideWarranty } from "@/lib/stateCompliance";
import { resolveOperatingState } from "@/lib/dealerState";
import { useVehiclePrefill, VehicleContextHeader } from "@/lib/vehiclePrefill";
import { toast } from "sonner";

type GuideType = "as-is" | "implied" | "warranty";
// Wave 28 — CA-market language expansion. en/es are FTC-canonical
// (the Spanish text is the FTC's official translation per 16 CFR
// Part 455 for sales conducted in Spanish). vi/ko/zh are dealer-
// courtesy translations for the California market — they don't
// satisfy the federal bilingual requirement (which is Spanish-
// specific) but they give dealers a defensible record that the
// customer received the FTC Buyers Guide content in a language
// they can read.
type Language = "en" | "es" | "vi" | "ko" | "zh";

const LANGUAGE_LABELS: Record<Language, string> = {
  en: "English",
  es: "Español",
  vi: "Tiếng Việt",
  ko: "한국어",
  zh: "中文",
};

interface VehicleInfo {
  year: string;
  make: string;
  model: string;
  vin: string;
  stock: string;
  mileage: string;
  price: string;
}

const LABELS: Record<Language, Record<string, string>> = {
  en: {
    title: "BUYERS GUIDE",
    important: "IMPORTANT: Spoken promises are difficult to enforce. Ask the dealer to put all promises in writing. Keep this form.",
    warranties_heading: "WARRANTIES FOR THIS VEHICLE:",
    as_is_title: "AS IS — NO DEALER WARRANTY",
    as_is_body: "The dealer does not provide a warranty for any repairs after sale. The dealer doesn't make any promises to fix things that need repair when you buy the vehicle or afterward. But implied warranties under your state's laws may give you some rights to have the dealer take care of serious problems that were not apparent when you bought the vehicle.",
    implied_title: "IMPLIED WARRANTIES ONLY",
    implied_body: "The dealer makes no warranties, express or implied, on this vehicle, except for implied warranties of merchantability. Implied warranty of merchantability means that the dealer warrants that the vehicle will pass without objection in the trade and is fit for the ordinary purpose for which it is used. The entire risk as to quality and performance is with the buyer. However, the buyer may have other rights under applicable state law.",
    warranty_title: "DEALER WARRANTY",
    warranty_body: "The dealer will pay a percentage of the labor and parts for the covered systems that fail during the warranty period. Ask the dealer for a copy of the warranty, and for any documents that explain warranty coverage, exclusions, and the dealer's repair obligations. Implied warranties under your state's laws may give you additional rights.",
    warranty_duration: "WARRANTY DURATION:",
    warranty_percentage: "PERCENTAGE OF COSTS COVERED:",
    covered_systems: "SYSTEMS COVERED:",
    system_engine: "Engine — All lubricated internal engine parts, water pump, fuel pump, manifolds, engine block, cylinder heads, rotary engine housings and flywheel.",
    system_transmission: "Transmission — All lubricated internal transmission parts, torque converter, drive shaft, universal joints, rear axle, and all internally lubricated parts.",
    system_steering: "Steering — The steering gear housing and all internal parts, power steering pump, valve body, piston and rack.",
    system_brakes: "Brakes — Master cylinder, vacuum assist booster, wheel cylinders, hydraulic lines and fittings, and disc brake calipers.",
    system_electrical: "Electrical — Alternator, voltage regulator, starter, ignition switch, and electronic ignition.",
    service_contact: "SERVICE CONTRACT",
    service_body: "A service contract is available at an extra charge on this vehicle. Ask for details as to coverage, deductible, price, and exclusions. If you buy a service contract within 90 days of the time of sale, state law \"implied warranties\" may give you additional rights.",
    pre_purchase: "Ask the dealer if your mechanic can inspect the vehicle on or off the lot.",
    vehicle_make: "Vehicle Make",
    vehicle_model: "Model",
    vehicle_year: "Year",
    vehicle_vin: "VIN Number",
    mileage: "Mileage",
    price: "Price",
    stock_no: "Stock No.",
    dealer_name: "Dealer Name",
    dealer_address: "Address",
  },
  es: {
    title: "GUÍA DEL COMPRADOR",
    important: "IMPORTANTE: Las promesas verbales son difíciles de hacer cumplir. Pida al concesionario que ponga todas las promesas por escrito. Conserve este formulario.",
    warranties_heading: "GARANTÍAS PARA ESTE VEHÍCULO:",
    as_is_title: "TAL COMO ESTÁ — SIN GARANTÍA DEL CONCESIONARIO",
    as_is_body: "El concesionario no ofrece una garantía para ninguna reparación después de la venta. El concesionario no hace ninguna promesa de arreglar las cosas que necesiten reparación cuando usted compra el vehículo o después. Pero las garantías implícitas bajo las leyes de su estado le pueden dar algunos derechos para hacer que el concesionario se ocupe de problemas graves que no eran evidentes cuando usted compró el vehículo.",
    implied_title: "SOLO GARANTÍAS IMPLÍCITAS",
    implied_body: "El concesionario no hace ninguna garantía, expresa o implícita, sobre este vehículo, excepto las garantías implícitas de comerciabilidad. La garantía implícita de comerciabilidad significa que el concesionario garantiza que el vehículo pasará sin objeción en el comercio y es apto para el propósito ordinario para el cual se usa. Todo el riesgo en cuanto a calidad y rendimiento es del comprador. Sin embargo, el comprador puede tener otros derechos según la ley estatal aplicable.",
    warranty_title: "GARANTÍA DEL CONCESIONARIO",
    warranty_body: "El concesionario pagará un porcentaje de la mano de obra y de las piezas de los sistemas cubiertos que fallen durante el período de garantía. Pídale al concesionario una copia de la garantía y cualquier documento que explique la cobertura de la garantía, las exclusiones y las obligaciones de reparación del concesionario. Las garantías implícitas bajo las leyes de su estado le pueden dar derechos adicionales.",
    warranty_duration: "DURACIÓN DE LA GARANTÍA:",
    warranty_percentage: "PORCENTAJE DE COSTOS CUBIERTOS:",
    covered_systems: "SISTEMAS CUBIERTOS:",
    system_engine: "Motor — Todas las partes internas lubricadas del motor, bomba de agua, bomba de combustible, múltiples, bloque del motor, cabezas de cilindros, carcasas del motor rotativo y volante.",
    system_transmission: "Transmisión — Todas las partes internas lubricadas de la transmisión, convertidor de torque, eje de transmisión, juntas universales, eje trasero y todas las partes lubricadas internamente.",
    system_steering: "Dirección — La carcasa del engranaje de dirección y todas las partes internas, bomba de dirección asistida, cuerpo de válvula, pistón y cremallera.",
    system_brakes: "Frenos — Cilindro maestro, refuerzo de vacío, cilindros de rueda, líneas hidráulicas y accesorios, y calibradores de frenos de disco.",
    system_electrical: "Eléctrico — Alternador, regulador de voltaje, motor de arranque, interruptor de encendido y encendido electrónico.",
    service_contact: "CONTRATO DE SERVICIO",
    service_body: "Un contrato de servicio está disponible con un cargo extra en este vehículo. Pregunte por los detalles sobre la cobertura, deducible, precio y exclusiones. Si compra un contrato de servicio dentro de los 90 días posteriores a la venta, las \"garantías implícitas\" de la ley estatal pueden darle derechos adicionales.",
    pre_purchase: "Pregúntele al concesionario si su mecánico puede inspeccionar el vehículo en el lote o fuera del lote.",
    vehicle_make: "Marca del Vehículo",
    vehicle_model: "Modelo",
    vehicle_year: "Año",
    vehicle_vin: "Número VIN",
    mileage: "Millaje",
    price: "Precio",
    stock_no: "No. de Stock",
    dealer_name: "Nombre del Concesionario",
    dealer_address: "Dirección",
  },
  vi: {
    title: "HƯỚNG DẪN NGƯỜI MUA",
    important: "QUAN TRỌNG: Lời hứa bằng lời nói khó thực thi. Yêu cầu đại lý ghi tất cả lời hứa bằng văn bản. Giữ lại biểu mẫu này.",
    warranties_heading: "BẢO HÀNH CHO XE NÀY:",
    as_is_title: "BÁN NGUYÊN TRẠNG — KHÔNG CÓ BẢO HÀNH CỦA ĐẠI LÝ",
    as_is_body: "Đại lý không cung cấp bảo hành cho bất kỳ sửa chữa nào sau khi bán. Đại lý không hứa sẽ sửa những thứ cần sửa chữa khi bạn mua xe hoặc sau đó. Nhưng các bảo hành ngụ ý theo luật tiểu bang của bạn có thể cho bạn một số quyền yêu cầu đại lý xử lý các vấn đề nghiêm trọng không rõ ràng khi bạn mua xe.",
    implied_title: "CHỈ CÓ BẢO HÀNH NGỤ Ý",
    implied_body: "Đại lý không đưa ra bất kỳ bảo hành nào, rõ ràng hay ngụ ý, đối với xe này, ngoại trừ các bảo hành ngụ ý về tính thương mại. Bảo hành ngụ ý về tính thương mại có nghĩa là đại lý bảo đảm rằng xe sẽ vượt qua mà không có sự phản đối trong thương mại và phù hợp với mục đích thông thường mà nó được sử dụng. Toàn bộ rủi ro về chất lượng và hiệu suất thuộc về người mua. Tuy nhiên, người mua có thể có các quyền khác theo luật tiểu bang hiện hành.",
    warranty_title: "BẢO HÀNH CỦA ĐẠI LÝ",
    warranty_body: "Đại lý sẽ trả một phần trăm chi phí lao động và phụ tùng cho các hệ thống được bảo hiểm bị hỏng trong thời gian bảo hành. Hãy yêu cầu đại lý cung cấp bản sao của bảo hành và bất kỳ tài liệu nào giải thích phạm vi bảo hành, các loại trừ và nghĩa vụ sửa chữa của đại lý. Các bảo hành ngụ ý theo luật tiểu bang của bạn có thể cho bạn thêm quyền.",
    warranty_duration: "THỜI HẠN BẢO HÀNH:",
    warranty_percentage: "PHẦN TRĂM CHI PHÍ ĐƯỢC BẢO HIỂM:",
    covered_systems: "HỆ THỐNG ĐƯỢC BẢO HIỂM:",
    system_engine: "Động cơ — Tất cả các bộ phận bên trong được bôi trơn của động cơ, bơm nước, bơm nhiên liệu, ống xả, khối động cơ, đầu xi-lanh, vỏ động cơ quay và bánh đà.",
    system_transmission: "Hộp số — Tất cả các bộ phận bên trong được bôi trơn của hộp số, bộ biến mô-men, trục truyền động, khớp các-đăng, trục sau và tất cả các bộ phận được bôi trơn bên trong.",
    system_steering: "Hệ thống lái — Vỏ bánh răng lái và tất cả các bộ phận bên trong, bơm trợ lực lái, thân van, piston và thước răng.",
    system_brakes: "Phanh — Xi-lanh chính, bộ trợ lực chân không, xi-lanh bánh xe, đường ống thủy lực và phụ kiện, và kẹp phanh đĩa.",
    system_electrical: "Hệ thống điện — Máy phát điện, bộ điều chỉnh điện áp, máy khởi động, công tắc đánh lửa và đánh lửa điện tử.",
    service_contact: "HỢP ĐỒNG DỊCH VỤ",
    service_body: "Hợp đồng dịch vụ có sẵn với chi phí bổ sung trên xe này. Hỏi chi tiết về phạm vi bảo hiểm, khấu trừ, giá cả và loại trừ. Nếu bạn mua hợp đồng dịch vụ trong vòng 90 ngày kể từ thời điểm bán, \"bảo hành ngụ ý\" của luật tiểu bang có thể cho bạn thêm quyền.",
    pre_purchase: "Hỏi đại lý xem thợ cơ khí của bạn có thể kiểm tra xe trong lô đất hoặc ngoài lô đất hay không.",
    vehicle_make: "Hãng xe",
    vehicle_model: "Mẫu",
    vehicle_year: "Năm",
    vehicle_vin: "Số VIN",
    mileage: "Số dặm",
    price: "Giá",
    stock_no: "Số tồn kho",
    dealer_name: "Tên đại lý",
    dealer_address: "Địa chỉ",
  },
  ko: {
    title: "구매자 안내서",
    important: "중요: 구두 약속은 집행하기 어렵습니다. 딜러에게 모든 약속을 서면으로 작성하도록 요청하십시오. 이 양식을 보관하십시오.",
    warranties_heading: "이 차량에 대한 보증:",
    as_is_title: "있는 그대로 — 딜러 보증 없음",
    as_is_body: "딜러는 판매 후 어떠한 수리에 대해서도 보증을 제공하지 않습니다. 딜러는 귀하가 차량을 구매할 때나 그 이후에 수리가 필요한 것을 고쳐 주겠다는 약속을 하지 않습니다. 그러나 해당 주법에 따른 묵시적 보증은 귀하가 차량을 구매할 때 드러나지 않았던 심각한 문제를 딜러가 처리하도록 하는 일부 권리를 귀하에게 부여할 수 있습니다.",
    implied_title: "묵시적 보증만 적용",
    implied_body: "딜러는 상품성에 대한 묵시적 보증을 제외하고 이 차량에 대해 명시적 또는 묵시적 보증을 하지 않습니다. 상품성에 대한 묵시적 보증은 딜러가 차량이 거래에서 이의 없이 통과될 것이며 사용 목적에 적합하다는 것을 보증한다는 의미입니다. 품질 및 성능에 대한 모든 위험은 구매자에게 있습니다. 그러나 구매자는 해당 주법에 따라 다른 권리를 가질 수 있습니다.",
    warranty_title: "딜러 보증",
    warranty_body: "딜러는 보증 기간 동안 고장 난 보장 시스템에 대한 인건비 및 부품 비용의 일정 비율을 지불합니다. 딜러에게 보증서 사본과 보증 범위, 제외 사항 및 딜러의 수리 의무를 설명하는 모든 문서를 요청하십시오. 해당 주법에 따른 묵시적 보증은 귀하에게 추가 권리를 부여할 수 있습니다.",
    warranty_duration: "보증 기간:",
    warranty_percentage: "보장 비용 비율:",
    covered_systems: "보장 시스템:",
    system_engine: "엔진 — 모든 윤활 내부 엔진 부품, 워터 펌프, 연료 펌프, 매니폴드, 엔진 블록, 실린더 헤드, 로터리 엔진 하우징 및 플라이휠.",
    system_transmission: "변속기 — 모든 윤활 내부 변속기 부품, 토크 컨버터, 드라이브 샤프트, 유니버설 조인트, 후방 액슬 및 모든 내부 윤활 부품.",
    system_steering: "조향 장치 — 조향 기어 하우징 및 모든 내부 부품, 파워 스티어링 펌프, 밸브 본체, 피스톤 및 랙.",
    system_brakes: "브레이크 — 마스터 실린더, 진공 부스터, 휠 실린더, 유압 라인 및 피팅, 디스크 브레이크 캘리퍼.",
    system_electrical: "전기 시스템 — 알터네이터, 전압 조절기, 스타터, 점화 스위치 및 전자 점화 장치.",
    service_contact: "서비스 계약",
    service_body: "이 차량에는 추가 비용으로 서비스 계약을 사용할 수 있습니다. 적용 범위, 공제액, 가격 및 제외 사항에 대한 세부 정보를 문의하십시오. 판매 시점으로부터 90일 이내에 서비스 계약을 구매하는 경우 주법의 \"묵시적 보증\"이 추가 권리를 부여할 수 있습니다.",
    pre_purchase: "귀하의 정비사가 차량을 부지 내 또는 외부에서 점검할 수 있는지 딜러에게 문의하십시오.",
    vehicle_make: "차량 제조사",
    vehicle_model: "모델",
    vehicle_year: "연식",
    vehicle_vin: "VIN 번호",
    mileage: "주행거리",
    price: "가격",
    stock_no: "재고 번호",
    dealer_name: "딜러 이름",
    dealer_address: "주소",
  },
  zh: {
    title: "买方指南",
    important: "重要提示：口头承诺难以执行。请要求经销商以书面形式提出所有承诺。保留此表格。",
    warranties_heading: "本车辆的保修：",
    as_is_title: "按现状出售 — 经销商无保修",
    as_is_body: "经销商不为销售后的任何维修提供保修。经销商不承诺在您购买车辆时或之后修理需要维修的物品。但根据您所在州法律的默示保修，您可能拥有某些权利，要求经销商处理您购买车辆时不明显的严重问题。",
    implied_title: "仅默示保修",
    implied_body: "除了适销性的默示保修外，经销商对本车辆不作任何明示或默示的保修。适销性默示保修意味着经销商保证车辆在贸易中将不会受到反对，并且适合其使用的普通目的。质量和性能的所有风险由买方承担。但是，根据适用的州法律，买方可能拥有其他权利。",
    warranty_title: "经销商保修",
    warranty_body: "经销商将支付保修期内出现故障的覆盖系统的人工和零件成本的一定百分比。请向经销商索取保修单副本以及任何说明保修范围、除外责任和经销商维修义务的文件。根据您所在州法律的默示保修，您可能拥有额外权利。",
    warranty_duration: "保修期：",
    warranty_percentage: "覆盖成本的百分比：",
    covered_systems: "覆盖的系统：",
    system_engine: "发动机 — 所有润滑的发动机内部零件、水泵、燃油泵、歧管、发动机缸体、气缸盖、转子发动机外壳和飞轮。",
    system_transmission: "变速箱 — 所有润滑的变速箱内部零件、扭矩转换器、传动轴、万向节、后桥以及所有内部润滑零件。",
    system_steering: "转向系统 — 转向齿轮箱及所有内部零件、动力转向泵、阀体、活塞和齿条。",
    system_brakes: "制动器 — 主缸、真空助力器、轮缸、液压管路和接头以及盘式制动卡钳。",
    system_electrical: "电气系统 — 交流发电机、电压调节器、起动机、点火开关和电子点火装置。",
    service_contact: "服务合同",
    service_body: "本车辆可以额外付费购买服务合同。请询问有关覆盖范围、免赔额、价格和除外责任的详细信息。如果您在销售时起 90 天内购买服务合同，州法律的\"默示保修\"可能会赋予您额外权利。",
    pre_purchase: "询问经销商您的技工是否可以在车场内或车场外检查此车辆。",
    vehicle_make: "车辆品牌",
    vehicle_model: "型号",
    vehicle_year: "年份",
    vehicle_vin: "VIN 号码",
    mileage: "里程",
    price: "价格",
    stock_no: "库存号",
    dealer_name: "经销商名称",
    dealer_address: "地址",
  },
};

const WARRANTY_SYSTEMS = ["system_engine", "system_transmission", "system_steering", "system_brakes", "system_electrical"];

const BuyersGuide = () => {
  const navigate = useNavigate();
  const { settings, loading: settingsLoading } = useDealerSettings();
  const { log } = useAudit();
  const { currentStore } = useTenant();
  const { user } = useAuth();
  const cardRef = useRef<HTMLDivElement>(null);

  const [guideType, setGuideType] = useState<GuideType>("as-is");
  // Admin's "FTC used-car warranty" default seeds the guide type once the
  // dealer's settings arrive (the provider renders before they load).
  const guideTypeSeeded = useRef(false);
  useEffect(() => {
    if (settingsLoading || guideTypeSeeded.current) return;
    guideTypeSeeded.current = true;
    if (settings.default_ftc_warranty === "implied") setGuideType("implied");
    else if (settings.default_ftc_warranty === "dealer") setGuideType("warranty");
  }, [settingsLoading, settings.default_ftc_warranty]);
  const [lang, setLang] = useState<Language>("en");
  const [vehicle, setVehicle] = useState<VehicleInfo>({
    year: "", make: "", model: "", vin: "", stock: "", mileage: "", price: "",
  });
  const [warrantyDuration, setWarrantyDuration] = useState("30 Days / 1,000 Miles");
  const [warrantyPct, setWarrantyPct] = useState("100%");
  const [coveredSystems, setCoveredSystems] = useState<string[]>(WARRANTY_SYSTEMS);

  // Prefill from a vehicle file (?vehicleId=…) so the dealer never re-keys
  // the YMM / VIN / mileage / price the Buyers Guide needs.
  const prefill = useVehiclePrefill((v) => {
    setVehicle((prev) => ({
      ...prev,
      year: v.year || prev.year,
      make: v.make || prev.make,
      model: v.model || prev.model,
      vin: v.vin || prev.vin,
      stock: v.stock || prev.stock,
      mileage: v.mileage || prev.mileage,
      price: v.price || prev.price,
    }));
  });

  // State-aware warranty box: several states override "As-Is" with a
  // mandatory used-vehicle warranty keyed to price/mileage. Driven by the
  // dealer's operating state + this vehicle's age/mileage/price.
  const operatingState = resolveOperatingState(settings, currentStore?.state);
  const bgResolution = useMemo(
    () =>
      resolveBuyersGuideWarranty(operatingState, {
        ageYears: vehicle.year ? new Date().getFullYear() - Number(vehicle.year) : undefined,
        mileage: vehicle.mileage ? Number(vehicle.mileage.replace(/[^0-9]/g, "")) : undefined,
        price: vehicle.price ? Number(vehicle.price.replace(/[^0-9.]/g, "")) : undefined,
      }),
    [operatingState, vehicle.year, vehicle.mileage, vehicle.price]
  );

  // Auto-populate the box + statutory floor whenever the inputs change.
  // Forced states lock As-Is; dealers may still RAISE warranty terms.
  useEffect(() => {
    setGuideType(bgResolution.box);
    if (bgResolution.box === "warranty" && bgResolution.minDurationDays > 0) {
      setWarrantyDuration(`${bgResolution.minDurationDays} Days / ${bgResolution.minMiles.toLocaleString()} Miles`);
      setWarrantyPct(`${bgResolution.minPct}%`);
    }
  }, [bgResolution]);

  const L = LABELS[lang];

  const handleSave = () => {
    const record = {
      id: crypto.randomUUID(),
      store_id: currentStore?.id || "",
      vehicle_vin: vehicle.vin,
      vehicle_ymm: [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" "),
      guide_type: guideType,
      language: lang,
      warranty_duration: warrantyDuration,
      warranty_percentage: warrantyPct,
      covered_systems: coveredSystems,
      created_by: user?.id || "",
      created_at: new Date().toISOString(),
    };
    const saved = JSON.parse(localStorage.getItem("buyers_guides") || "[]");
    saved.push(record);
    localStorage.setItem("buyers_guides", JSON.stringify(saved));
    log({ store_id: currentStore?.id || "", user_id: user?.id || "", action: "buyers_guide_created", entity_type: "buyers_guide", entity_id: record.id, details: { vin: vehicle.vin, type: guideType, language: lang } });
    toast.success("Buyers Guide saved!");
  };

  const handlePrint = () => window.print();

  const handleDownloadPdf = async () => {
    const card = cardRef.current;
    if (!card) return;
    try {
      const { default: html2canvas } = await import("html2canvas-pro");
      const { default: jsPDF } = await import("jspdf");
      const { archivePdf, persistArchivedPdf } = await import("@/lib/pdfArchive");
      const canvas = await html2canvas(card, { scale: 2, useCORS: true, onclone: (await import("@/lib/html2canvasInputs")).replaceInputsForCanvas } as any);
      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      const pdfWidth = 8.5;
      const pdfHeight = (canvas.height / canvas.width) * pdfWidth;
      const pdf = new jsPDF({ unit: "in", format: [pdfWidth, pdfHeight], orientation: "portrait" });
      pdf.addImage(imgData, "JPEG", 0, 0, pdfWidth, pdfHeight);
      await archivePdf(pdf, { vehicle, guideType, lang }, {
        tenantId: currentStore?.id || null,
        tenantName: currentStore?.name || null,
        vin: vehicle.vin || null,
      });
      pdf.save(`Buyers-Guide-${vehicle.vin || "draft"}.pdf`);
      persistArchivedPdf(pdf, {
        docType: "buyers_guide",
        entityId: vehicle.vin || `buyers-guide-${Date.now()}`,
        vin: vehicle.vin || null,
      }).catch(() => { /* archive best-effort */ });
    } catch (err) {
      console.error("PDF generation failed:", err);
    }
  };

  return (
    <div className="min-h-screen bg-background py-4 px-2 md:px-4">
      {prefill.active && (
        <div className="max-w-[8.5in] mx-auto mb-3">
          <VehicleContextHeader state={prefill} />
        </div>
      )}
      {/* Controls */}
      <div className="max-w-[8.5in] mx-auto mb-3 flex flex-wrap gap-2 items-center no-print">
        <button onClick={() => navigate("/addendum")} className="font-semibold text-[13px] px-5 py-2 rounded-md bg-navy text-primary-foreground tracking-[0.4px] hover:opacity-85">
          ← Back to Addendum
        </button>
        <div className="flex flex-col gap-1">
          <div className="flex gap-1 bg-muted rounded-md p-0.5">
            {(["as-is", "implied", "warranty"] as GuideType[]).map((t) => {
              const locked = bgResolution.forced && t === "as-is";
              return (
                <button
                  key={t}
                  onClick={() => { if (!locked) setGuideType(t); }}
                  disabled={locked}
                  title={locked ? bgResolution.reason : undefined}
                  className={`text-[12px] font-semibold px-3 py-1.5 rounded ${guideType === t ? "bg-navy text-primary-foreground" : "text-muted-foreground hover:text-foreground"} ${locked ? "opacity-40 cursor-not-allowed line-through" : ""}`}
                >
                  {t === "as-is" ? "As-Is" : t === "implied" ? "Implied" : "Warranty"}
                </button>
              );
            })}
          </div>
          {(bgResolution.forced || bgResolution.needsVerification) && bgResolution.reason && (
            <p className="text-[10px] text-amber-700 max-w-xs">
              {bgResolution.reason}{bgResolution.citation ? ` (${bgResolution.citation})` : ""} — confirm with counsel.
            </p>
          )}
        </div>
        {(settings.feature_spanish_buyers_guide || settings.feature_multilang_buyers_guide) && (
          <div className="flex gap-1 bg-muted rounded-md p-0.5 flex-wrap">
            <button
              onClick={() => setLang("en")}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded ${lang === "en" ? "bg-action text-primary-foreground" : "text-muted-foreground"}`}
            >
              {LANGUAGE_LABELS.en}
            </button>
            {settings.feature_spanish_buyers_guide && (
              <button
                onClick={() => setLang("es")}
                className={`text-[12px] font-semibold px-3 py-1.5 rounded ${lang === "es" ? "bg-action text-primary-foreground" : "text-muted-foreground"}`}
              >
                {LANGUAGE_LABELS.es}
              </button>
            )}
            {settings.feature_multilang_buyers_guide && (["vi", "ko", "zh"] as Language[]).map(code => (
              <button
                key={code}
                onClick={() => setLang(code)}
                className={`text-[12px] font-semibold px-3 py-1.5 rounded ${lang === code ? "bg-action text-primary-foreground" : "text-muted-foreground"}`}
                title={`FTC Buyers Guide content rendered in ${LANGUAGE_LABELS[code]} (dealer-courtesy translation)`}
              >
                {LANGUAGE_LABELS[code]}
              </button>
            ))}
          </div>
        )}
        <button onClick={handlePrint} className="font-semibold text-[13px] px-5 py-2 rounded-md bg-navy text-primary-foreground tracking-[0.4px] hover:opacity-85">
          Print
        </button>
        <button onClick={handleDownloadPdf} className="font-semibold text-[13px] px-5 py-2 rounded-md bg-navy text-primary-foreground tracking-[0.4px] hover:opacity-85">
          Download PDF
        </button>
        {user && (
          <button onClick={handleSave} className="font-semibold text-[13px] px-5 py-2 rounded-md bg-teal text-primary-foreground tracking-[0.4px] hover:opacity-85">
            Save Guide
          </button>
        )}
      </div>

      {/* Guide Card — FTC mandates minimum 11" high × 7.25" wide (16 CFR § 455) */}
      <div ref={cardRef} className="mx-auto bg-card shadow-lg rounded-lg overflow-hidden border-2 border-foreground" style={{ minWidth: "7.25in", minHeight: "11in", maxWidth: "8.5in" }}>
        {/* Header */}
        <div className="bg-foreground text-card text-center py-3 px-4">
          <h1 className="text-2xl font-extrabold tracking-wide font-barlow-condensed uppercase">{L.title}</h1>
        </div>

        {/* Important notice */}
        <div className="bg-gold/20 border-b-2 border-foreground px-4 py-2">
          <p className="text-[10px] font-bold text-foreground leading-tight">{L.important}</p>
        </div>

        {/* Vehicle info */}
        <div className="grid grid-cols-4 gap-3 px-4 py-3 border-b-2 border-foreground">
          {[
            { label: L.vehicle_year, key: "year" as const },
            { label: L.vehicle_make, key: "make" as const },
            { label: L.vehicle_model, key: "model" as const },
            { label: L.stock_no, key: "stock" as const },
          ].map(f => (
            <div key={f.key}>
              <span className="text-[8px] font-bold text-muted-foreground uppercase">{f.label}</span>
              <input
                value={vehicle[f.key]}
                onChange={(e) => setVehicle({ ...vehicle, [f.key]: e.target.value })}
                className="w-full border-b border-border-custom bg-transparent text-xs text-foreground outline-none py-0.5"
              />
            </div>
          ))}
          <div className="col-span-2">
            <span className="text-[8px] font-bold text-muted-foreground uppercase">{L.vehicle_vin}</span>
            <input
              value={vehicle.vin}
              onChange={(e) => setVehicle({ ...vehicle, vin: e.target.value })}
              className="w-full border-b border-border-custom bg-transparent text-xs text-foreground outline-none py-0.5 font-mono"
            />
          </div>
          <div>
            <span className="text-[8px] font-bold text-muted-foreground uppercase">{L.mileage}</span>
            <input
              value={vehicle.mileage}
              onChange={(e) => setVehicle({ ...vehicle, mileage: e.target.value })}
              className="w-full border-b border-border-custom bg-transparent text-xs text-foreground outline-none py-0.5"
            />
          </div>
          <div>
            <span className="text-[8px] font-bold text-muted-foreground uppercase">{L.price}</span>
            <input
              value={vehicle.price}
              onChange={(e) => setVehicle({ ...vehicle, price: e.target.value })}
              className="w-full border-b border-border-custom bg-transparent text-xs text-foreground outline-none py-0.5"
            />
          </div>
        </div>

        {/* Warranties heading */}
        <div className="px-4 py-2 border-b border-foreground bg-muted/30">
          <p className="text-xs font-extrabold text-foreground">{L.warranties_heading}</p>
        </div>

        {/* Guide type content */}
        <div className="px-4 py-3 space-y-3">
          {guideType === "as-is" && (
            <div className="border-2 border-foreground rounded p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-5 h-5 border-2 border-foreground flex items-center justify-center text-xs font-bold">✓</div>
                <h3 className="text-sm font-extrabold text-foreground">{L.as_is_title}</h3>
              </div>
              <p className="text-[10px] text-foreground leading-relaxed">{L.as_is_body}</p>
            </div>
          )}

          {guideType === "implied" && (
            <div className="border-2 border-foreground rounded p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-5 h-5 border-2 border-foreground flex items-center justify-center text-xs font-bold">✓</div>
                <h3 className="text-sm font-extrabold text-foreground">{L.implied_title}</h3>
              </div>
              <p className="text-[10px] text-foreground leading-relaxed">{L.implied_body}</p>
            </div>
          )}

          {guideType === "warranty" && (
            <div className="border-2 border-foreground rounded p-3 space-y-2">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-5 h-5 border-2 border-foreground flex items-center justify-center text-xs font-bold">✓</div>
                <h3 className="text-sm font-extrabold text-foreground">{L.warranty_title}</h3>
              </div>
              <p className="text-[10px] text-foreground">{L.warranty_body}</p>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <div>
                  <span className="text-[9px] font-bold text-muted-foreground">{L.warranty_duration}</span>
                  <input
                    value={warrantyDuration}
                    onChange={(e) => setWarrantyDuration(e.target.value)}
                    className="w-full border-b border-border-custom bg-transparent text-xs text-foreground outline-none py-0.5"
                  />
                </div>
                <div>
                  <span className="text-[9px] font-bold text-muted-foreground">{L.warranty_percentage}</span>
                  <input
                    value={warrantyPct}
                    onChange={(e) => setWarrantyPct(e.target.value)}
                    className="w-full border-b border-border-custom bg-transparent text-xs text-foreground outline-none py-0.5"
                  />
                </div>
              </div>

              <div className="pt-2">
                <p className="text-[9px] font-bold text-muted-foreground mb-1">{L.covered_systems}</p>
                <div className="space-y-1">
                  {WARRANTY_SYSTEMS.map((sys) => (
                    <label key={sys} className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={coveredSystems.includes(sys)}
                        onChange={(e) => {
                          setCoveredSystems(e.target.checked
                            ? [...coveredSystems, sys]
                            : coveredSystems.filter(s => s !== sys)
                          );
                        }}
                        className="mt-0.5"
                      />
                      <span className="text-[9px] text-foreground leading-tight">{L[sys]}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Non-selected options shown unchecked */}
          {guideType !== "as-is" && (
            <div className="border border-border-custom rounded p-3 opacity-50">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 border-2 border-border-custom" />
                <h3 className="text-sm font-bold text-muted-foreground">{L.as_is_title}</h3>
              </div>
            </div>
          )}
          {guideType !== "implied" && (
            <div className="border border-border-custom rounded p-3 opacity-50">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 border-2 border-border-custom" />
                <h3 className="text-sm font-bold text-muted-foreground">{L.implied_title}</h3>
              </div>
            </div>
          )}
          {guideType !== "warranty" && (
            <div className="border border-border-custom rounded p-3 opacity-50">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 border-2 border-border-custom" />
                <h3 className="text-sm font-bold text-muted-foreground">{L.warranty_title}</h3>
              </div>
            </div>
          )}
        </div>

        {/* Service contract */}
        <div className="px-4 py-3 border-t-2 border-foreground">
          <h3 className="text-xs font-extrabold text-foreground mb-1">{L.service_contact}</h3>
          <p className="text-[9px] text-foreground leading-relaxed">{L.service_body}</p>
        </div>

        {/* Pre-purchase */}
        <div className="px-4 py-3 border-t-2 border-foreground bg-muted/30">
          <p className="text-[9px] font-bold text-foreground">{L.pre_purchase}</p>
        </div>

        {/* Dealer info footer */}
        <div className="px-4 py-3 border-t-2 border-foreground">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-[8px] font-bold text-muted-foreground uppercase">{L.dealer_name}</span>
              <p className="text-xs font-semibold text-foreground">{settings.dealer_name}</p>
            </div>
            <div>
              <span className="text-[8px] font-bold text-muted-foreground uppercase">{L.dealer_address}</span>
              <p className="text-xs text-foreground">{settings.dealer_tagline}</p>
            </div>
          </div>
        </div>

        {/* BACK OF BUYERS GUIDE — FTC Required (16 CFR § 455) */}
        <div className="border-t-4 border-foreground mt-1">
          <div className="px-4 py-3 bg-muted/20">
            <p className="text-[10px] font-extrabold text-foreground mb-2">IMPORTANT: Refer to this information when you visit the dealer!</p>

            <p className="text-[8px] text-foreground leading-relaxed mb-2">
              <strong>Contract Cancellation:</strong> Federal law does not provide a "cooling off" period for used car purchases. In some states, once you sign a contract, you may not be able to cancel it. Check with your state's Attorney General's office or consumer protection agency.
            </p>

            <p className="text-[8px] text-foreground leading-relaxed mb-2">
              <strong>Vehicle History Reports:</strong> Before you buy a used vehicle, ask the dealer if the vehicle has a history report. This report may contain important information about the vehicle's title, odometer, and damage history.
            </p>

            <p className="text-[8px] text-foreground leading-relaxed mb-2">
              <strong>Vehicle Return Policies:</strong> Some dealers may offer a return policy, money-back guarantee, or exchange privilege. Be sure to get any return policy in writing and understand its terms and conditions.
            </p>

            <p className="text-[8px] text-foreground leading-relaxed mb-2">
              <strong>Below is a list of some of the major defects that may occur in used motor vehicles:</strong>
            </p>

            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[7px] text-foreground mb-2">
              <div><strong>Frame & Body:</strong> Frame cracks, damage, or repairs; water damage or flood damage</div>
              <div><strong>Engine:</strong> Oil leaks, excessive oil consumption, unusual noises, poor compression</div>
              <div><strong>Transmission:</strong> Slipping, rough shifting, unusual noises, fluid leaks</div>
              <div><strong>Differential:</strong> Excessive noise, fluid leaks</div>
              <div><strong>Cooling System:</strong> Leaks, overheating, water pump failure</div>
              <div><strong>Electrical:</strong> Alternator, starter, wiring problems, battery failure</div>
              <div><strong>Fuel System:</strong> Leaks, fuel pump failure, emission control issues</div>
              <div><strong>Brakes:</strong> Worn pads/shoes, fluid leaks, brake failure, ABS malfunction</div>
              <div><strong>Steering:</strong> Excessive play, hard steering, fluid leaks, alignment</div>
              <div><strong>Suspension:</strong> Worn shocks/struts, broken springs, ball joint failure</div>
              <div><strong>Tires:</strong> Uneven wear, damage, improper size</div>
              <div><strong>Exhaust:</strong> Leaks, catalytic converter failure, excessive emissions</div>
              <div><strong>Air Conditioning:</strong> Inoperative, refrigerant leaks, compressor failure</div>
              <div><strong>Air Bags:</strong> Inoperative, previously deployed, warning light on</div>
            </div>

            <p className="text-[7px] text-muted-foreground leading-relaxed">
              <strong>COMPLAINT PROCEDURE:</strong> If you have a complaint about the vehicle or the conduct of the dealer, contact: your state's Attorney General's office, your state's motor vehicle regulatory agency, the Better Business Bureau (BBB), or the Federal Trade Commission (FTC) at ftc.gov or 1-877-FTC-HELP.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BuyersGuide;
