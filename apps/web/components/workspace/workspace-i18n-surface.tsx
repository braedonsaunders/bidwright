"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { DEFAULT_LOCALE, normalizeLocale, type SupportedLocale } from "@/lib/i18n";

type NonEnglishLocale = Exclude<SupportedLocale, typeof DEFAULT_LOCALE>;

const LOCALES = ["es", "fr-CA", "de", "pt-BR", "zh-CN", "ja", "ko", "hi", "ar"] as const;

const ENTRIES: Array<[string, ...string[]]> = [
  ["Setup", "Configuración", "Configuration", "Einrichtung", "Configuração", "设置", "設定", "설정", "सेटअप", "الإعداد"],
  ["Estimate", "Estimación", "Estimation", "Kalkulation", "Estimativa", "估算", "見積", "견적", "अनुमान", "التقدير"],
  ["Documents", "Documentos", "Documents", "Dokumente", "Documentos", "文档", "ドキュメント", "문서", "दस्तावेज़", "المستندات"],
  ["Summarize", "Resumir", "Résumer", "Zusammenfassen", "Resumir", "汇总", "要約", "요약", "सारांश", "تلخيص"],
  ["Review", "Revisión", "Révision", "Prüfung", "Revisão", "审核", "レビュー", "검토", "समीक्षा", "مراجعة"],
  ["Activity", "Actividad", "Activité", "Aktivität", "Atividade", "活动", "アクティビティ", "활동", "गतिविधि", "النشاط"],
  ["Takeoff", "Medición", "Métré", "Aufmaß", "Levantamento", "算量", "拾い出し", "물량 산출", "टेकऑफ", "حصر الكميات"],
  ["Worksheets", "Hojas de trabajo", "Feuilles de travail", "Arbeitsblätter", "Planilhas", "工作表", "ワークシート", "워크시트", "वर्कशीट", "أوراق العمل"],
  ["Factors", "Factores", "Facteurs", "Faktoren", "Fatores", "系数", "係数", "계수", "कारक", "العوامل"],
  ["Phases", "Fases", "Phases", "Phasen", "Fases", "阶段", "フェーズ", "단계", "चरण", "المراحل"],
  ["Snap", "Rápida", "Rapide", "Kurzangebot", "Rápido", "快速", "スナップ", "스냅", "स्नैप", "سريع"],
  ["Open", "Abierto", "Ouvert", "Offen", "Aberto", "打开", "未完了", "열림", "खुला", "مفتوح"],
  ["All", "Todo", "Tout", "Alle", "Tudo", "全部", "すべて", "전체", "सभी", "الكل"],
  ["No", "No", "Non", "Nein", "Não", "无", "なし", "없음", "नहीं", "لا"],
  ["Filter", "Filtro", "Filtre", "Filter", "Filtro", "筛选器", "フィルター", "필터", "फ़िल्टर", "مرشح"],
  ["2W", "2 sem.", "2 sem.", "2 W.", "2 sem.", "2周", "2週", "2주", "2 सप्ताह", "أسبوعان"],
  ["This", "Este", "Ce", "Diese", "Este", "此", "この", "이", "यह", "هذا"],
  ["Page", "Página", "Page", "Seite", "Página", "页面", "ページ", "페이지", "पृष्ठ", "الصفحة"],
  ["Pages", "Páginas", "Pages", "Seiten", "Páginas", "页面", "ページ", "페이지", "पृष्ठ", "الصفحات"],
  ["Document", "Documento", "Document", "Dokument", "Documento", "文档", "ドキュメント", "문서", "दस्तावेज़", "المستند"],
  ["Results", "Resultados", "Résultats", "Ergebnisse", "Resultados", "结果", "結果", "결과", "परिणाम", "النتائج"],
  ["Choose", "Elegir", "Choisir", "Auswählen", "Escolher", "选择", "選択", "선택", "चुनें", "اختر"],
  ["Intake", "Ingreso", "Intake", "Erfassung", "Entrada", "录入", "取り込み", "접수", "इंटेक", "الإدخال"],
  ["Mark", "Marca", "Marque", "Markierung", "Marca", "标记", "マーク", "마크", "चिह्न", "علامة"],
  ["Marks", "Marcas", "Marques", "Markierungen", "Marcas", "标记", "マーク", "마크", "चिह्न", "العلامات"],
  ["Link", "Vincular", "Lier", "Verknüpfen", "Vincular", "链接", "リンク", "연결", "लिंक", "ربط"],
  ["a", "un", "un", "ein", "um", "一个", "1つの", "하나의", "एक", "واحد"],
  ["an", "un", "un", "ein", "um", "一个", "1つの", "하나의", "एक", "واحد"],
  ["the", "el", "le", "der", "o", "该", "その", "해당", "वह", "الـ"],
  ["to", "a", "à", "zu", "para", "到", "へ", "에", "को", "إلى"],
  ["from", "desde", "depuis", "von", "de", "来自", "から", "에서", "से", "من"],
  ["by", "por", "par", "nach", "por", "按", "別", "기준", "द्वारा", "حسب"],
  ["as", "como", "comme", "als", "como", "作为", "として", "로", "के रूप में", "كـ"],
  ["or", "o", "ou", "oder", "ou", "或", "または", "또는", "या", "أو"],
  ["and", "y", "et", "und", "e", "和", "と", "및", "और", "و"],
  ["with", "con", "avec", "mit", "com", "带", "あり", "포함", "के साथ", "مع"],
  ["before", "antes de", "avant", "vor", "antes de", "之前", "前", "전", "से पहले", "قبل"],
  ["after", "después de", "après", "nach", "depois de", "之后", "後", "후", "के बाद", "بعد"],
  ["for", "para", "pour", "für", "para", "用于", "用", "용", "के लिए", "لـ"],
  ["in", "en", "dans", "in", "em", "在", "内", "에서", "में", "في"],
  ["on", "en", "sur", "auf", "em", "在", "上", "에", "पर", "على"],
  ["of", "de", "de", "von", "de", "的", "の", "의", "का", "من"],
  ["at", "a", "à", "bei", "em", "在", "で", "에서", "पर", "عند"],
  ["Pending", "Pendiente", "En attente", "Ausstehend", "Pendente", "待定", "保留中", "대기 중", "लंबित", "قيد الانتظار"],
  ["Awarded", "Adjudicado", "Attribué", "Vergeben", "Concedido", "已中标", "受注", "수주", "प्राप्त", "مُرسى"],
  ["Did Not Get", "No ganado", "Non retenu", "Nicht erhalten", "Não ganho", "未中标", "失注", "실패", "नहीं मिला", "لم يتم الفوز"],
  ["Declined", "Rechazado", "Refusé", "Abgelehnt", "Recusado", "已拒绝", "辞退", "거절됨", "अस्वीकृत", "مرفوض"],
  ["Cancelled", "Cancelado", "Annulé", "Storniert", "Cancelado", "已取消", "キャンセル", "취소됨", "रद्द", "ملغى"],
  ["Closed", "Cerrado", "Fermé", "Geschlossen", "Fechado", "已关闭", "完了", "닫힘", "बंद", "مغلق"],
  ["Other", "Otro", "Autre", "Sonstiges", "Outro", "其他", "その他", "기타", "अन्य", "أخرى"],
  ["Firm", "Firme", "Ferme", "Festpreis", "Firme", "固定", "確定", "확정", "फर्म", "ثابت"],
  ["Budget", "Presupuesto", "Budget", "Budget", "Orçamento", "预算", "概算", "예산", "बजट", "ميزانية"],
  ["Budget DNE", "Presupuesto DNE", "Budget DNE", "Budget DNE", "Orçamento DNE", "预算 DNE", "概算 DNE", "예산 DNE", "बजट DNE", "ميزانية DNE"],
  ["Cost", "Costo", "Coût", "Kosten", "Custo", "成本", "原価", "비용", "लागत", "التكلفة"],
  ["Profit", "Ganancia", "Profit", "Gewinn", "Lucro", "利润", "利益", "이익", "लाभ", "الربح"],
  ["Hrs", "Hrs", "H", "Std.", "Hrs", "小时", "時間", "시간", "घं.", "ساعات"],
  ["Actions", "Acciones", "Actions", "Aktionen", "Ações", "操作", "アクション", "작업", "कार्रवाइयाँ", "الإجراءات"],
  ["Open plugin tools", "Abrir herramientas de plugins", "Ouvrir les outils de modules", "Plugin-Werkzeuge öffnen", "Abrir ferramentas de plugin", "打开插件工具", "プラグインツールを開く", "플러그인 도구 열기", "प्लगइन उपकरण खोलें", "فتح أدوات المكونات الإضافية"],
  ["PDF", "PDF", "PDF", "PDF", "PDF", "PDF", "PDF", "PDF", "PDF", "PDF"],
  ["Generate PDF", "Generar PDF", "Générer le PDF", "PDF erzeugen", "Gerar PDF", "生成 PDF", "PDFを生成", "PDF 생성", "PDF बनाएँ", "إنشاء PDF"],
  ["Generating PDF...", "Generando PDF...", "Génération du PDF...", "PDF wird erzeugt...", "Gerando PDF...", "正在生成 PDF...", "PDFを生成中...", "PDF 생성 중...", "PDF बन रहा है...", "جارٍ إنشاء PDF..."],
  ["Send Quote", "Enviar cotización", "Envoyer le devis", "Angebot senden", "Enviar cotação", "发送报价", "見積を送信", "견적 보내기", "कोटेशन भेजें", "إرسال عرض السعر"],
  ["Copy Quote", "Copiar cotización", "Copier le devis", "Angebot kopieren", "Copiar cotação", "复制报价", "見積をコピー", "견적 복사", "कोटेशन कॉपी करें", "نسخ عرض السعر"],
  ["New Revision", "Nueva revisión", "Nouvelle révision", "Neue Revision", "Nova revisão", "新修订", "新規リビジョン", "새 개정", "नई संशोधन", "مراجعة جديدة"],
  ["Compare Revisions", "Comparar revisiones", "Comparer les révisions", "Revisionen vergleichen", "Comparar revisões", "比较修订", "リビジョンを比較", "개정 비교", "संशोधनों की तुलना", "مقارنة المراجعات"],
  ["Make Current Rev. 0", "Hacer revisión actual 0", "Mettre la rév. actuelle à 0", "Aktuelle Rev. zu 0 machen", "Tornar revisão atual 0", "将当前修订设为 0", "現在のRevを0にする", "현재 개정을 0으로 설정", "वर्तमान संशोधन 0 करें", "اجعل المراجعة الحالية 0"],
  ["Delete Revision", "Eliminar revisión", "Supprimer la révision", "Revision löschen", "Excluir revisão", "删除修订", "リビジョンを削除", "개정 삭제", "संशोधन हटाएँ", "حذف المراجعة"],
  ["Danger", "Peligro", "Danger", "Gefahr", "Perigo", "危险", "危険", "위험", "खतरा", "خطر"],
  ["Delete Quote", "Eliminar cotización", "Supprimer le devis", "Angebot löschen", "Excluir cotação", "删除报价", "見積を削除", "견적 삭제", "कोटेशन हटाएँ", "حذف عرض السعر"],
  ["Revision history", "Historial de revisiones", "Historique des révisions", "Revisionsverlauf", "Histórico de revisões", "修订历史", "リビジョン履歴", "개정 기록", "संशोधन इतिहास", "سجل المراجعات"],
  ["Current", "Actual", "Actuelle", "Aktuell", "Atual", "当前", "現在", "현재", "वर्तमान", "الحالي"],
  ["New", "Nuevo", "Nouveau", "Neu", "Novo", "新建", "新規", "새로 만들기", "नया", "جديد"],
  ["Compare", "Comparar", "Comparer", "Vergleichen", "Comparar", "比较", "比較", "비교", "तुलना", "مقارنة"],
  ["Make Rev 0", "Hacer Rev 0", "Faire rév. 0", "Rev. 0 machen", "Tornar Rev 0", "设为修订 0", "Rev 0にする", "Rev 0으로 설정", "Rev 0 करें", "جعلها مراجعة 0"],
  ["Delete Current Revision", "Eliminar revisión actual", "Supprimer la révision actuelle", "Aktuelle Revision löschen", "Excluir revisão atual", "删除当前修订", "現在のリビジョンを削除", "현재 개정 삭제", "वर्तमान संशोधन हटाएँ", "حذف المراجعة الحالية"],
  ["Switch estimate revision", "Cambiar revisión de estimación", "Changer de révision d’estimation", "Kalkulationsrevision wechseln", "Trocar revisão da estimativa", "切换估算修订", "見積リビジョンを切替", "견적 개정 전환", "अनुमान संशोधन बदलें", "تبديل مراجعة التقدير"],
  ["Snap title", "Título rápido", "Titre rapide", "Kurzangebotstitel", "Título rápido", "快速报价标题", "スナップタイトル", "스냅 제목", "स्नैप शीर्षक", "عنوان سريع"],
  ["Saving...", "Guardando...", "Enregistrement...", "Speichern...", "Salvando...", "正在保存...", "保存中...", "저장 중...", "सहेजा जा रहा है...", "جارٍ الحفظ..."],
  ["Upgrade to Quote", "Convertir a cotización", "Convertir en devis", "In Angebot umwandeln", "Converter em cotação", "升级为报价", "見積にアップグレード", "견적으로 업그레이드", "कोटेशन में अपग्रेड करें", "ترقية إلى عرض سعر"],
  ["Client", "Cliente", "Client", "Kunde", "Cliente", "客户", "顧客", "고객", "ग्राहक", "العميل"],
  ["Site", "Sitio", "Site", "Standort", "Local", "现场", "現場", "현장", "साइट", "الموقع"],
  ["Valid Until", "Válido hasta", "Valide jusqu’au", "Gültig bis", "Válido até", "有效至", "有効期限", "유효 기간", "तक मान्य", "صالح حتى"],
  ["Scope", "Alcance", "Portée", "Leistungsumfang", "Escopo", "范围", "範囲", "범위", "दायरा", "النطاق"],
  ["Select client...", "Seleccionar cliente...", "Sélectionner un client...", "Kunden auswählen...", "Selecionar cliente...", "选择客户...", "顧客を選択...", "고객 선택...", "ग्राहक चुनें...", "اختر العميل..."],
  ["Search clients...", "Buscar clientes...", "Rechercher des clients...", "Kunden suchen...", "Buscar clientes...", "搜索客户...", "顧客を検索...", "고객 검색...", "ग्राहक खोजें...", "البحث عن العملاء..."],
  ["No clients found", "No se encontraron clientes", "Aucun client trouvé", "Keine Kunden gefunden", "Nenhum cliente encontrado", "未找到客户", "顧客が見つかりません", "고객 없음", "कोई ग्राहक नहीं मिला", "لم يتم العثور على عملاء"],
  ["Short customer-facing scope summary", "Resumen breve del alcance para el cliente", "Bref résumé de portée destiné au client", "Kurze Leistungsbeschreibung für Kunden", "Resumo curto do escopo para o cliente", "面向客户的简短范围摘要", "顧客向けの短い範囲概要", "고객용 짧은 범위 요약", "ग्राहक के लिए छोटा दायरा सारांश", "ملخص نطاق قصير للعميل"],
  ["Rate Books", "Libros de tarifas", "Livres de taux", "Satzbücher", "Livros de taxas", "费率书", "レートブック", "요율표", "दर पुस्तिकाएँ", "دفاتر الأسعار"],
  ["Catalogs", "Catálogos", "Catalogues", "Kataloge", "Catálogos", "目录", "カタログ", "카탈로그", "कैटलॉग", "الكتالوجات"],
  ["Labor Units", "Unidades de mano de obra", "Unités de main-d’œuvre", "Arbeitseinheiten", "Unidades de mão de obra", "人工单位", "労務単位", "노무 단위", "श्रम इकाइयाँ", "وحدات العمالة"],
  ["Cost Intel", "Inteligencia de costos", "Info coûts", "Kosteninfo", "Inteligência de custos", "成本情报", "コスト情報", "비용 정보", "लागत इंटेल", "معلومات التكلفة"],
  ["Assemblies", "Ensamblajes", "Assemblages", "Baugruppen", "Montagens", "组件", "アセンブリ", "어셈블리", "असेंबली", "التجميعات"],
  ["External Searches", "Búsquedas externas", "Recherches externes", "Externe Suchen", "Pesquisas externas", "外部搜索", "外部検索", "외부 검색", "बाहरी खोज", "عمليات بحث خارجية"],
  ["Provider searches and tools that return line items", "Búsquedas y herramientas de proveedores que devuelven partidas", "Recherches et outils fournisseurs qui renvoient des lignes", "Anbietersuchen und Werkzeuge, die Positionen liefern", "Pesquisas e ferramentas de fornecedores que retornam linhas", "返回明细项的供应商搜索和工具", "明細行を返すプロバイダー検索とツール", "라인 항목을 반환하는 공급자 검색 및 도구", "लाइन आइटम लौटाने वाली प्रदाता खोजें और उपकरण", "عمليات بحث وأدوات المزوّد التي تُرجع بنودًا"],
  ["All types", "Todos los tipos", "Tous les types", "Alle Typen", "Todos os tipos", "所有类型", "すべての種類", "모든 유형", "सभी प्रकार", "كل الأنواع"],
  ["Add", "Agregar", "Ajouter", "Hinzufügen", "Adicionar", "添加", "追加", "추가", "जोड़ें", "إضافة"],
  ["Multi", "Múltiple", "Multiple", "Mehrere", "Múltiplo", "多选", "複数", "여러 개", "बहु", "متعدد"],
  ["Visible Columns", "Columnas visibles", "Colonnes visibles", "Sichtbare Spalten", "Colunas visíveis", "可见列", "表示列", "표시 열", "दृश्यमान स्तंभ", "الأعمدة المرئية"],
  ["Blank Row", "Fila en blanco", "Ligne vide", "Leere Zeile", "Linha em branco", "空白行", "空白行", "빈 행", "खाली पंक्ति", "صف فارغ"],
  ["Start with an empty worksheet line", "Empezar con una línea de hoja vacía", "Commencer avec une ligne de feuille vide", "Mit einer leeren Arbeitsblattzeile beginnen", "Começar com uma linha vazia", "从空白工作表行开始", "空のワークシート行から開始", "빈 워크시트 행으로 시작", "खाली वर्कशीट पंक्ति से शुरू करें", "ابدأ بسطر ورقة عمل فارغ"],
  ["New worksheet", "Nueva hoja", "Nouvelle feuille", "Neues Arbeitsblatt", "Nova planilha", "新工作表", "新規ワークシート", "새 워크시트", "नई वर्कशीट", "ورقة عمل جديدة"],
  ["Worksheet name", "Nombre de hoja", "Nom de la feuille", "Arbeitsblattname", "Nome da planilha", "工作表名称", "ワークシート名", "워크시트 이름", "वर्कशीट नाम", "اسم ورقة العمل"],
  ["New folder", "Nueva carpeta", "Nouveau dossier", "Neuer Ordner", "Nova pasta", "新文件夹", "新規フォルダー", "새 폴더", "नया फ़ोल्डर", "مجلد جديد"],
  ["Folder name", "Nombre de carpeta", "Nom du dossier", "Ordnername", "Nome da pasta", "文件夹名称", "フォルダー名", "폴더 이름", "फ़ोल्डर नाम", "اسم المجلد"],
  ["Destination", "Destino", "Destination", "Ziel", "Destino", "目标", "移動先", "대상", "गंतव्य", "الوجهة"],
  ["Delete worksheet?", "¿Eliminar hoja?", "Supprimer la feuille?", "Arbeitsblatt löschen?", "Excluir planilha?", "删除工作表？", "ワークシートを削除しますか？", "워크시트를 삭제할까요?", "वर्कशीट हटाएँ?", "حذف ورقة العمل؟"],
  ["This cannot be undone.", "Esto no se puede deshacer.", "Cette action est irréversible.", "Dies kann nicht rückgängig gemacht werden.", "Isso não pode ser desfeito.", "此操作无法撤销。", "これは元に戻せません。", "이 작업은 되돌릴 수 없습니다.", "इसे पूर्ववत नहीं किया जा सकता।", "لا يمكن التراجع عن هذا."],
  ["Delete folder?", "¿Eliminar carpeta?", "Supprimer le dossier?", "Ordner löschen?", "Excluir pasta?", "删除文件夹？", "フォルダーを削除しますか？", "폴더를 삭제할까요?", "फ़ोल्डर हटाएँ?", "حذف المجلد؟"],
  ["Worksheets inside it will be moved up one level.", "Las hojas dentro se moverán un nivel arriba.", "Les feuilles qu’il contient remonteront d’un niveau.", "Enthaltene Arbeitsblätter werden eine Ebene nach oben verschoben.", "As planilhas dentro dele subirão um nível.", "其中的工作表将上移一级。", "中のワークシートは1階層上に移動します。", "내부 워크시트가 한 단계 위로 이동합니다.", "इसके अंदर की वर्कशीट एक स्तर ऊपर जाएगी।", "سيتم نقل أوراق العمل داخله مستوى واحدًا للأعلى."],
  ["All worksheets", "Todas las hojas", "Toutes les feuilles", "Alle Arbeitsblätter", "Todas as planilhas", "所有工作表", "すべてのワークシート", "모든 워크시트", "सभी वर्कशीट", "كل أوراق العمل"],
  ["No worksheets yet.", "Aún no hay hojas.", "Aucune feuille pour l’instant.", "Noch keine Arbeitsblätter.", "Ainda não há planilhas.", "还没有工作表。", "まだワークシートがありません。", "아직 워크시트가 없습니다.", "अभी कोई वर्कशीट नहीं है।", "لا توجد أوراق عمل بعد."],
  ["New row", "Nueva fila", "Nouvelle ligne", "Neue Zeile", "Nova linha", "新行", "新しい行", "새 행", "नई पंक्ति", "صف جديد"],
  ["Add description...", "Agregar descripción...", "Ajouter une description...", "Beschreibung hinzufügen...", "Adicionar descrição...", "添加描述...", "説明を追加...", "설명 추가...", "विवरण जोड़ें...", "إضافة وصف..."],
  ["Line Factors", "Factores de línea", "Facteurs de ligne", "Zeilenfaktoren", "Fatores de linha", "行系数", "行係数", "라인 계수", "लाइन कारक", "عوامل السطر"],
  ["Applied to this line", "Aplicado a esta línea", "Appliqué à cette ligne", "Auf diese Zeile angewendet", "Aplicado a esta linha", "应用于此行", "この行に適用", "이 라인에 적용됨", "इस पंक्ति पर लागू", "مطبق على هذا السطر"],
  ["No line factors yet.", "Aún no hay factores de línea.", "Aucun facteur de ligne pour l’instant.", "Noch keine Zeilenfaktoren.", "Ainda não há fatores de linha.", "还没有行系数。", "行係数はまだありません。", "아직 라인 계수가 없습니다.", "अभी कोई लाइन कारक नहीं है।", "لا توجد عوامل سطر بعد."],
  ["Save", "Guardar", "Enregistrer", "Speichern", "Salvar", "保存", "保存", "저장", "सहेजें", "حفظ"],
  ["Cancel", "Cancelar", "Annuler", "Abbrechen", "Cancelar", "取消", "キャンセル", "취소", "रद्द करें", "إلغاء"],
  ["Edit", "Editar", "Modifier", "Bearbeiten", "Editar", "编辑", "編集", "편집", "संपादित करें", "تعديل"],
  ["Add from library", "Agregar desde biblioteca", "Ajouter depuis la bibliothèque", "Aus Bibliothek hinzufügen", "Adicionar da biblioteca", "从库添加", "ライブラリから追加", "라이브러리에서 추가", "लाइब्रेरी से जोड़ें", "إضافة من المكتبة"],
  ["No matching line-capable factors.", "No hay factores de línea coincidentes.", "Aucun facteur applicable à une ligne.", "Keine passenden zeilenfähigen Faktoren.", "Nenhum fator de linha correspondente.", "没有匹配的行级系数。", "一致する行対応係数がありません。", "일치하는 라인 계수가 없습니다.", "मेल खाते लाइन-सक्षम कारक नहीं हैं।", "لا توجد عوامل مناسبة للسطر."],
  ["Quote Details", "Detalles de cotización", "Détails du devis", "Angebotsdetails", "Detalhes da cotação", "报价详细信息", "見積詳細", "견적 세부 정보", "कोटेशन विवरण", "تفاصيل عرض السعر"],
  ["Quote Title", "Título de cotización", "Titre du devis", "Angebotstitel", "Título da cotação", "报价标题", "見積タイトル", "견적 제목", "कोटेशन शीर्षक", "عنوان عرض السعر"],
  ["Contact", "Contacto", "Contact", "Kontakt", "Contato", "联系人", "連絡先", "연락처", "संपर्क", "جهة الاتصال"],
  ["Department", "Departamento", "Département", "Abteilung", "Departamento", "部门", "部門", "부서", "विभाग", "القسم"],
  ["Type", "Tipo", "Type", "Typ", "Tipo", "类型", "種類", "유형", "प्रकार", "النوع"],
  ["Quote Date", "Fecha de cotización", "Date du devis", "Angebotsdatum", "Data da cotação", "报价日期", "見積日", "견적일", "कोटेशन तिथि", "تاريخ عرض السعر"],
  ["Due Date", "Fecha límite", "Date d’échéance", "Fälligkeitsdatum", "Data de vencimento", "截止日期", "期限日", "마감일", "देय तिथि", "تاريخ الاستحقاق"],
  ["Description / Scope of Work", "Descripción / Alcance del trabajo", "Description / Portée des travaux", "Beschreibung / Leistungsumfang", "Descrição / Escopo do trabalho", "描述 / 工作范围", "説明 / 作業範囲", "설명 / 작업 범위", "विवरण / कार्य दायरा", "الوصف / نطاق العمل"],
  ["Inclusions", "Inclusiones", "Inclus", "Einschlüsse", "Inclusões", "包含项", "含まれる項目", "포함 항목", "समावेशन", "المشمولة"],
  ["Exclusions", "Exclusiones", "Exclusions", "Ausschlüsse", "Exclusões", "不包含项", "除外項目", "제외 항목", "बहिष्करण", "الاستثناءات"],
  ["Clarifications", "Aclaraciones", "Clarifications", "Klarstellungen", "Esclarecimentos", "澄清", "補足説明", "명확화", "स्पष्टीकरण", "التوضيحات"],
  ["Rate Schedules", "Tablas de tarifas", "Barèmes de taux", "Satzpläne", "Tabelas de taxas", "费率表", "レート表", "요율표", "दर अनुसूचियाँ", "جداول الأسعار"],
  ["Sources", "Fuentes", "Sources", "Quellen", "Fontes", "来源", "ソース", "소스", "स्रोत", "المصادر"],
  ["Labour units", "Unidades laborales", "Unités de main-d’œuvre", "Arbeitseinheiten", "Unidades de mão de obra", "人工单位", "労務単位", "노무 단위", "श्रम इकाइयाँ", "وحدات العمالة"],
  ["Shipping & Logistics", "Envío y logística", "Expédition et logistique", "Versand und Logistik", "Envio e logística", "运输与物流", "配送と物流", "배송 및 물류", "शिपिंग और लॉजिस्टिक्स", "الشحن والخدمات اللوجستية"],
  ["Estimated Ship Date", "Fecha estimada de envío", "Date d’expédition estimée", "Voraussichtliches Versanddatum", "Data estimada de envio", "预计发货日期", "出荷予定日", "예상 배송일", "अनुमानित शिप तिथि", "تاريخ الشحن المتوقع"],
  ["Shipping Method", "Método de envío", "Mode d’expédition", "Versandmethode", "Método de envio", "运输方式", "配送方法", "배송 방법", "शिपिंग विधि", "طريقة الشحن"],
  ["Freight On Board", "Flete a bordo", "Franco à bord", "Fracht frei an Bord", "Frete a bordo", "离岸价", "FOB", "FOB", "फ्रेट ऑन बोर्ड", "الشحن على ظهر السفينة"],
  ["Schedule", "Programa", "Calendrier", "Terminplan", "Cronograma", "计划", "スケジュール", "일정", "कार्यक्रम", "الجدول"],
  ["Walkdown Date", "Fecha de recorrido", "Date de visite", "Begehungsdatum", "Data de vistoria", "现场检查日期", "現地確認日", "현장 점검일", "वॉकडाउन तिथि", "تاريخ المعاينة"],
  ["Work Start Date", "Fecha de inicio", "Date de début des travaux", "Arbeitsbeginn", "Data de início", "开工日期", "作業開始日", "작업 시작일", "कार्य प्रारंभ तिथि", "تاريخ بدء العمل"],
  ["Work End Date", "Fecha de fin", "Date de fin des travaux", "Arbeitsende", "Data de término", "完工日期", "作業終了日", "작업 종료일", "कार्य समाप्ति तिथि", "تاريخ انتهاء العمل"],
  ["Follow-Up & Assignment", "Seguimiento y asignación", "Suivi et affectation", "Nachverfolgung und Zuweisung", "Acompanhamento e atribuição", "跟进与分配", "フォローアップと割当", "후속 조치 및 배정", "फ़ॉलो-अप और असाइनमेंट", "المتابعة والتعيين"],
  ["Follow-Up Note", "Nota de seguimiento", "Note de suivi", "Nachverfolgungsnotiz", "Nota de acompanhamento", "跟进备注", "フォローアップメモ", "후속 메모", "फ़ॉलो-अप नोट", "ملاحظة متابعة"],
  ["Assigned Estimator", "Estimador asignado", "Estimateur assigné", "Zugewiesener Kalkulator", "Estimador atribuído", "指定估算员", "担当見積者", "배정된 견적 담당자", "असाइन किया गया अनुमानक", "المقدّر المعين"],
  ["Create Worksheet", "Crear hoja", "Créer une feuille", "Arbeitsblatt erstellen", "Criar planilha", "创建工作表", "ワークシートを作成", "워크시트 만들기", "वर्कशीट बनाएँ", "إنشاء ورقة عمل"],
  ["Worksheet Name", "Nombre de hoja", "Nom de la feuille", "Arbeitsblattname", "Nome da planilha", "工作表名称", "ワークシート名", "워크시트 이름", "वर्कशीट नाम", "اسم ورقة العمل"],
  ["Rename Worksheet", "Renombrar hoja", "Renommer la feuille", "Arbeitsblatt umbenennen", "Renomear planilha", "重命名工作表", "ワークシート名を変更", "워크시트 이름 변경", "वर्कशीट का नाम बदलें", "إعادة تسمية ورقة العمل"],
  ["Recipients", "Destinatarios", "Destinataires", "Empfänger", "Destinatários", "收件人", "宛先", "수신자", "प्राप्तकर्ता", "المستلمون"],
  ["Comma-separated email addresses", "Direcciones de correo separadas por comas", "Adresses courriel séparées par des virgules", "E-Mail-Adressen durch Kommas getrennt", "E-mails separados por vírgulas", "用逗号分隔的电子邮件地址", "カンマ区切りのメールアドレス", "쉼표로 구분된 이메일 주소", "कॉमा से अलग ईमेल पते", "عناوين بريد مفصولة بفواصل"],
  ["Message", "Mensaje", "Message", "Nachricht", "Mensagem", "消息", "メッセージ", "메시지", "संदेश", "الرسالة"],
  ["Create Job", "Crear trabajo", "Créer un chantier", "Auftrag erstellen", "Criar trabalho", "创建作业", "ジョブを作成", "작업 만들기", "जॉब बनाएँ", "إنشاء مهمة"],
  ["Job Name", "Nombre del trabajo", "Nom du chantier", "Auftragsname", "Nome do trabalho", "作业名称", "ジョブ名", "작업 이름", "जॉब नाम", "اسم المهمة"],
  ["Foreman", "Capataz", "Contremaître", "Vorarbeiter", "Encarregado", "工长", "職長", "현장 반장", "फोरमैन", "المشرف"],
  ["Project Manager", "Gerente de proyecto", "Gestionnaire de projet", "Projektleiter", "Gerente de projeto", "项目经理", "プロジェクトマネージャー", "프로젝트 관리자", "परियोजना प्रबंधक", "مدير المشروع"],
  ["Start Date", "Fecha de inicio", "Date de début", "Startdatum", "Data de início", "开始日期", "開始日", "시작일", "प्रारंभ तिथि", "تاريخ البدء"],
  ["Ship Date", "Fecha de envío", "Date d’expédition", "Versanddatum", "Data de envio", "发货日期", "出荷日", "배송일", "शिप तिथि", "تاريخ الشحن"],
  ["PO Number", "Número de OC", "No de bon de commande", "Bestellnummer", "Número do pedido", "采购订单号", "PO番号", "PO 번호", "PO नंबर", "رقم أمر الشراء"],
  ["PO Issuer", "Emisor de OC", "Émetteur du bon", "Bestellaussteller", "Emissor do pedido", "采购订单签发人", "PO発行者", "PO 발행자", "PO जारीकर्ता", "مُصدر أمر الشراء"],
  ["Import Line Items", "Importar partidas", "Importer des lignes", "Positionen importieren", "Importar linhas", "导入明细项", "明細行をインポート", "라인 항목 가져오기", "लाइन आइटम आयात करें", "استيراد البنود"],
  ["File (CSV / XLSX)", "Archivo (CSV / XLSX)", "Fichier (CSV / XLSX)", "Datei (CSV / XLSX)", "Arquivo (CSV / XLSX)", "文件 (CSV / XLSX)", "ファイル (CSV / XLSX)", "파일 (CSV / XLSX)", "फ़ाइल (CSV / XLSX)", "ملف (CSV / XLSX)"],
  ["Column Mapping", "Mapeo de columnas", "Mappage des colonnes", "Spaltenzuordnung", "Mapeamento de colunas", "列映射", "列マッピング", "열 매핑", "कॉलम मैपिंग", "تعيين الأعمدة"],
  ["Source Column", "Columna origen", "Colonne source", "Quellspalte", "Coluna de origem", "源列", "ソース列", "원본 열", "स्रोत स्तंभ", "عمود المصدر"],
  ["Map To", "Asignar a", "Mapper vers", "Zuordnen zu", "Mapear para", "映射到", "マップ先", "매핑 대상", "इससे मैप करें", "تعيين إلى"],
  ["Preview (first 5 rows)", "Vista previa (primeras 5 filas)", "Aperçu (5 premières lignes)", "Vorschau (erste 5 Zeilen)", "Prévia (5 primeiras linhas)", "预览（前 5 行）", "プレビュー（最初の5行）", "미리보기(처음 5행)", "पूर्वावलोकन (पहली 5 पंक्तियाँ)", "معاينة (أول 5 صفوف)"],
  ["AI Phase Generation", "Generación de fases con IA", "Génération de phases IA", "KI-Phasenerstellung", "Geração de fases por IA", "AI 阶段生成", "AIフェーズ生成", "AI 단계 생성", "AI चरण निर्माण", "إنشاء مراحل بالذكاء الاصطناعي"],
  ["Source Document", "Documento fuente", "Document source", "Quelldokument", "Documento de origem", "源文档", "ソース文書", "원본 문서", "स्रोत दस्तावेज़", "المستند المصدر"],
  ["Generate Phases", "Generar fases", "Générer les phases", "Phasen erzeugen", "Gerar fases", "生成阶段", "フェーズを生成", "단계 생성", "चरण बनाएँ", "إنشاء المراحل"],
  ["Accept Phases", "Aceptar fases", "Accepter les phases", "Phasen übernehmen", "Aceitar fases", "接受阶段", "フェーズを承認", "단계 적용", "चरण स्वीकार करें", "قبول المراحل"],
  ["AI Equipment Extraction", "Extracción de equipos con IA", "Extraction d’équipement IA", "KI-Geräteextraktion", "Extração de equipamentos por IA", "AI 设备提取", "AI設備抽出", "AI 장비 추출", "AI उपकरण निष्कर्षण", "استخراج المعدات بالذكاء الاصطناعي"],
  ["Extract Equipment", "Extraer equipos", "Extraire l’équipement", "Geräte extrahieren", "Extrair equipamentos", "提取设备", "設備を抽出", "장비 추출", "उपकरण निकालें", "استخراج المعدات"],
  ["Accept Equipment", "Aceptar equipos", "Accepter l’équipement", "Geräte übernehmen", "Aceitar equipamentos", "接受设备", "設備を承認", "장비 적용", "उपकरण स्वीकार करें", "قبول المعدات"],
  ["Activity Log", "Registro de actividad", "Journal d’activité", "Aktivitätsprotokoll", "Registro de atividade", "活动日志", "アクティビティログ", "활동 로그", "गतिविधि लॉग", "سجل النشاط"],
  ["No activity recorded.", "No hay actividad registrada.", "Aucune activité enregistrée.", "Keine Aktivität aufgezeichnet.", "Nenhuma atividade registrada.", "未记录活动。", "記録されたアクティビティはありません。", "기록된 활동이 없습니다.", "कोई गतिविधि दर्ज नहीं।", "لا يوجد نشاط مسجل."],
  ["PDF Preview & Download", "Vista previa y descarga de PDF", "Aperçu et téléchargement PDF", "PDF-Vorschau und Download", "Prévia e download do PDF", "PDF 预览和下载", "PDFプレビューとダウンロード", "PDF 미리보기 및 다운로드", "PDF पूर्वावलोकन और डाउनलोड", "معاينة وتنزيل PDF"],
  ["Template", "Plantilla", "Gabarit", "Vorlage", "Modelo", "模板", "テンプレート", "템플릿", "टेम्पलेट", "القالب"],
  ["Sections", "Secciones", "Sections", "Abschnitte", "Seções", "部分", "セクション", "섹션", "अनुभाग", "الأقسام"],
  ["Attach Documents", "Adjuntar documentos", "Joindre des documents", "Dokumente anhängen", "Anexar documentos", "附加文档", "文書を添付", "문서 첨부", "दस्तावेज़ संलग्न करें", "إرفاق المستندات"],
  ["Download PDF", "Descargar PDF", "Télécharger le PDF", "PDF herunterladen", "Baixar PDF", "下载 PDF", "PDFをダウンロード", "PDF 다운로드", "PDF डाउनलोड करें", "تنزيل PDF"],
  ["Standard", "Estándar", "Standard", "Standard", "Padrão", "标准", "標準", "표준", "मानक", "قياسي"],
  ["Detailed", "Detallado", "Détaillé", "Detailliert", "Detalhado", "详细", "詳細", "상세", "विस्तृत", "مفصل"],
  ["Summary Only", "Solo resumen", "Résumé seulement", "Nur Zusammenfassung", "Somente resumo", "仅摘要", "概要のみ", "요약만", "केवल सारांश", "ملخص فقط"],
  ["Client Facing", "Para cliente", "Destiné au client", "Kundenansicht", "Voltado ao cliente", "面向客户", "顧客向け", "고객용", "ग्राहक हेतु", "موجه للعميل"],
  ["Cover Page", "Portada", "Page couverture", "Deckblatt", "Capa", "封面", "表紙", "표지", "कवर पेज", "صفحة الغلاف"],
  ["Line Items", "Partidas", "Lignes", "Positionen", "Linhas", "明细项", "明細行", "라인 항목", "लाइन आइटम", "البنود"],
  ["Report Sections", "Secciones del informe", "Sections du rapport", "Berichtsabschnitte", "Seções do relatório", "报告部分", "レポートセクション", "보고서 섹션", "रिपोर्ट अनुभाग", "أقسام التقرير"],
  ["Rollup", "Resumen", "Regroupement", "Rollup", "Rollup", "汇总", "ロールアップ", "롤업", "रोलअप", "تجميع"],
  ["Adjustments", "Ajustes", "Ajustements", "Anpassungen", "Ajustes", "调整", "調整", "조정", "समायोजन", "التعديلات"],
  ["Price Build", "Construcción de precio", "Construction du prix", "Preisaufbau", "Composição de preço", "价格构成", "価格構成", "가격 구성", "मूल्य निर्माण", "بناء السعر"],
  ["Cost Mix", "Mezcla de costos", "Composition des coûts", "Kostenmix", "Mix de custos", "成本组合", "コスト構成", "비용 구성", "लागत मिश्रण", "مزيج التكلفة"],
  ["Resource Detail", "Detalle de recursos", "Détail des ressources", "Ressourcendetails", "Detalhe de recursos", "资源明细", "リソース詳細", "리소스 세부 정보", "संसाधन विवरण", "تفاصيل الموارد"],
  ["Quick Total", "Total rápido", "Total rapide", "Schnellsumme", "Total rápido", "快速总计", "クイック合計", "빠른 합계", "त्वरित कुल", "إجمالي سريع"],
  ["By Phase", "Por fase", "Par phase", "Nach Phase", "Por fase", "按阶段", "フェーズ別", "단계별", "चरण अनुसार", "حسب المرحلة"],
  ["By Category", "Por categoría", "Par catégorie", "Nach Kategorie", "Por categoria", "按类别", "カテゴリ別", "범주별", "श्रेणी अनुसार", "حسب الفئة"],
  ["By Worksheet", "Por hoja", "Par feuille", "Nach Arbeitsblatt", "Por planilha", "按工作表", "ワークシート別", "워크시트별", "वर्कशीट अनुसार", "حسب ورقة العمل"],
  ["None", "Ninguno", "Aucun", "Keine", "Nenhum", "无", "なし", "없음", "कोई नहीं", "لا شيء"],
  ["Category", "Categoría", "Catégorie", "Kategorie", "Categoria", "类别", "カテゴリ", "범주", "श्रेणी", "الفئة"],
  ["Worksheet", "Hoja", "Feuille", "Arbeitsblatt", "Planilha", "工作表", "ワークシート", "워크시트", "वर्कशीट", "ورقة العمل"],
  ["Construction Code", "Código de construcción", "Code de construction", "Baucode", "Código de construção", "施工代码", "建設コード", "시공 코드", "निर्माण कोड", "كود البناء"],
  ["Percent Modifier", "Modificador porcentual", "Modificateur en pourcentage", "Prozentaufschlag", "Modificador percentual", "百分比调整", "パーセント修正", "백분율 조정", "प्रतिशत संशोधक", "معدل النسبة"],
  ["Additional Line Item", "Partida adicional", "Ligne supplémentaire", "Zusätzliche Position", "Linha adicional", "附加明细项", "追加明細行", "추가 라인 항목", "अतिरिक्त लाइन आइटम", "بند إضافي"],
  ["Optional Add", "Adición opcional", "Ajout optionnel", "Optionale Ergänzung", "Adicional opcional", "可选增加", "任意追加", "선택 추가", "वैकल्पिक जोड़", "إضافة اختيارية"],
  ["Optional Standalone", "Opción independiente", "Option autonome", "Option eigenständig", "Opcional independente", "独立可选项", "任意単独項目", "선택 독립 항목", "वैकल्पिक स्वतंत्र", "اختياري مستقل"],
  ["Standalone Line Item", "Partida independiente", "Ligne autonome", "Eigenständige Position", "Linha independente", "独立明细项", "単独明細行", "독립 라인 항목", "स्वतंत्र लाइन आइटम", "بند مستقل"],
  ["Custom Total", "Total personalizado", "Total personnalisé", "Benutzerdefinierte Summe", "Total personalizado", "自定义总计", "カスタム合計", "사용자 지정 합계", "कस्टम कुल", "إجمالي مخصص"],
  ["Overhead", "Gastos generales", "Frais généraux", "Gemeinkosten", "Custos indiretos", "管理费", "間接費", "간접비", "ओवरहेड", "المصاريف العامة"],
  ["Tax", "Impuesto", "Taxe", "Steuer", "Imposto", "税", "税", "세금", "कर", "الضريبة"],
  ["Contingency", "Contingencia", "Contingence", "Reserve", "Contingência", "应急费", "予備費", "예비비", "आकस्मिक", "الاحتياطي"],
  ["Insurance", "Seguro", "Assurance", "Versicherung", "Seguro", "保险", "保険", "보험", "बीमा", "التأمين"],
  ["Bond", "Fianza", "Cautionnement", "Bürgschaft", "Garantia", "保函", "保証", "보증", "बॉन्ड", "الضمان"],
  ["Allowance", "Asignación", "Provision", "Zulage", "Verba", "暂列金额", "許容額", "허용액", "भत्ता", "المخصص"],
  ["Alternate", "Alternativa", "Variante", "Alternative", "Alternativa", "备选", "代替案", "대안", "विकल्प", "بديل"],
  ["Fee", "Honorario", "Frais", "Gebühr", "Taxa", "费用", "手数料", "수수료", "शुल्क", "رسوم"],
  ["Selected Scope", "Alcance seleccionado", "Portée sélectionnée", "Ausgewählter Umfang", "Escopo selecionado", "选定范围", "選択範囲", "선택 범위", "चयनित दायरा", "النطاق المحدد"],
  ["Line Subtotal", "Subtotal de líneas", "Sous-total des lignes", "Zeilenzwischensumme", "Subtotal das linhas", "明细小计", "行小計", "라인 소계", "लाइन उप-योग", "المجموع الفرعي للبنود"],
  ["Direct Cost", "Costo directo", "Coût direct", "Direktkosten", "Custo direto", "直接成本", "直接原価", "직접 비용", "प्रत्यक्ष लागत", "التكلفة المباشرة"],
  ["Cumulative Total", "Total acumulado", "Total cumulatif", "Kumulierte Summe", "Total acumulado", "累计总计", "累計合計", "누적 합계", "संचयी कुल", "الإجمالي التراكمي"],
  ["Layer", "Capa", "Couche", "Ebene", "Camada", "层", "レイヤー", "계층", "परत", "الطبقة"],
  ["Base", "Base", "Base", "Basis", "Base", "基础", "ベース", "기준", "आधार", "الأساس"],
  ["Amount", "Importe", "Montant", "Betrag", "Valor", "金额", "金額", "금액", "राशि", "المبلغ"],
  ["Running", "Acumulado", "Cumul", "Laufend", "Acumulado", "运行总计", "累計", "누계", "चलता कुल", "الجاري"],
  ["Show", "Mostrar", "Afficher", "Anzeigen", "Mostrar", "显示", "表示", "표시", "दिखाएँ", "إظهار"],
  ["Quote Total", "Total de cotización", "Total du devis", "Angebotssumme", "Total da cotação", "报价总额", "見積合計", "견적 합계", "कोटेशन कुल", "إجمالي عرض السعر"],
  ["Items", "Elementos", "Articles", "Positionen", "Itens", "项目", "項目", "항목", "आइटम", "العناصر"],
  ["Hours", "Horas", "Heures", "Stunden", "Horas", "小时", "時間", "시간", "घंटे", "الساعات"],
  ["Coverage", "Cobertura", "Couverture", "Abdeckung", "Cobertura", "覆盖率", "カバレッジ", "커버리지", "कवरेज", "التغطية"],
  ["Coverage Score", "Puntaje de cobertura", "Score de couverture", "Abdeckungswert", "Pontuação de cobertura", "覆盖评分", "カバレッジスコア", "커버리지 점수", "कवरेज स्कोर", "درجة التغطية"],
  ["Potential Savings", "Ahorros potenciales", "Économies potentielles", "Potenzielle Einsparungen", "Economias potenciais", "潜在节省", "潜在節約", "잠재 절감", "संभावित बचत", "وفورات محتملة"],
  ["Overall Assessment", "Evaluación general", "Évaluation globale", "Gesamtbewertung", "Avaliação geral", "总体评估", "総合評価", "종합 평가", "समग्र आकलन", "التقييم العام"],
  ["Scope Coverage", "Cobertura de alcance", "Couverture de portée", "Leistungsabdeckung", "Cobertura do escopo", "范围覆盖", "範囲カバレッジ", "범위 커버리지", "दायरा कवरेज", "تغطية النطاق"],
  ["No coverage data yet", "Aún no hay datos de cobertura", "Aucune donnée de couverture pour l’instant", "Noch keine Abdeckungsdaten", "Ainda não há dados de cobertura", "还没有覆盖数据", "まだカバレッジデータがありません", "아직 커버리지 데이터가 없습니다", "अभी कोई कवरेज डेटा नहीं", "لا توجد بيانات تغطية بعد"],
  ["Ref", "Ref.", "Réf.", "Ref.", "Ref.", "引用", "参照", "참조", "संदर्भ", "مرجع"],
  ["Requirement", "Requisito", "Exigence", "Anforderung", "Requisito", "要求", "要件", "요구사항", "आवश्यकता", "المتطلب"],
  ["Status", "Estado", "Statut", "Status", "Status", "状态", "ステータス", "상태", "स्थिति", "الحالة"],
  ["Gaps & Risks", "Brechas y riesgos", "Lacunes et risques", "Lücken und Risiken", "Lacunas e riscos", "差距与风险", "ギャップとリスク", "격차 및 위험", "अंतराल और जोखिम", "الفجوات والمخاطر"],
  ["Add Finding", "Agregar hallazgo", "Ajouter une constatation", "Befund hinzufügen", "Adicionar apontamento", "添加发现", "所見を追加", "발견 사항 추가", "निष्कर्ष जोड़ें", "إضافة ملاحظة"],
  ["No findings yet", "Aún no hay hallazgos", "Aucune constatation pour l’instant", "Noch keine Befunde", "Ainda não há apontamentos", "还没有发现", "まだ所見がありません", "아직 발견 사항이 없습니다", "अभी कोई निष्कर्ष नहीं", "لا توجد ملاحظات بعد"],
  ["Critical", "Crítico", "Critique", "Kritisch", "Crítico", "严重", "重大", "심각", "गंभीर", "حرج"],
  ["Warning", "Advertencia", "Avertissement", "Warnung", "Aviso", "警告", "警告", "경고", "चेतावनी", "تحذير"],
  ["Info", "Información", "Info", "Info", "Info", "信息", "情報", "정보", "जानकारी", "معلومات"],
  ["Resolved", "Resuelto", "Résolu", "Gelöst", "Resolvido", "已解决", "解決済み", "해결됨", "समाधान हुआ", "تم الحل"],
  ["Dismissed", "Descartado", "Rejeté", "Verworfen", "Dispensado", "已忽略", "却下", "해제됨", "खारिज", "تم التجاهل"],
  ["Severity", "Severidad", "Gravité", "Schweregrad", "Severidade", "严重性", "重大度", "심각도", "गंभीरता", "الشدة"],
  ["State", "Estado", "État", "Zustand", "Estado", "状态", "状態", "상태", "स्थिति", "الحالة"],
  ["Spec Ref", "Ref. de especificación", "Réf. spéc.", "Spez.-Ref.", "Ref. de especificação", "规格引用", "仕様参照", "사양 참조", "स्पेक संदर्भ", "مرجع المواصفة"],
  ["Impact", "Impacto", "Impact", "Auswirkung", "Impacto", "影响", "影響", "영향", "प्रभाव", "الأثر"],
  ["Title", "Título", "Titre", "Titel", "Título", "标题", "タイトル", "제목", "शीर्षक", "العنوان"],
  ["Description", "Descripción", "Description", "Beschreibung", "Descrição", "描述", "説明", "설명", "विवरण", "الوصف"],
  ["Resolution Note", "Nota de resolución", "Note de résolution", "Lösungsnotiz", "Nota de resolução", "解决备注", "解決メモ", "해결 메모", "समाधान नोट", "ملاحظة الحل"],
  ["Competitiveness", "Competitividad", "Compétitivité", "Wettbewerbsfähigkeit", "Competitividade", "竞争力", "競争力", "경쟁력", "प्रतिस्पर्धात्मकता", "التنافسية"],
  ["Potential Overestimates", "Posibles sobreestimaciones", "Surestimations potentielles", "Mögliche Überschätzungen", "Possíveis superestimativas", "潜在高估", "潜在的な過大見積", "잠재적 과대견적", "संभावित अधिक अनुमान", "مبالغات محتملة"],
  ["Potential Underestimates", "Posibles subestimaciones", "Sous-estimations potentielles", "Mögliche Unterschätzungen", "Possíveis subestimativas", "潜在低估", "潜在的な過小見積", "잠재적 과소견적", "संभावित कम अनुमान", "تقديرات ناقصة محتملة"],
  ["Productivity", "Productividad", "Productivité", "Produktivität", "Produtividade", "生产率", "生産性", "생산성", "उत्पादकता", "الإنتاجية"],
  ["Recommendations", "Recomendaciones", "Recommandations", "Empfehlungen", "Recomendações", "建议", "推奨事項", "권장 사항", "सिफारिशें", "التوصيات"],
  ["Quality Score", "Puntaje de calidad", "Score de qualité", "Qualitätswert", "Pontuação de qualidade", "质量评分", "品質スコア", "품질 점수", "गुणवत्ता स्कोर", "درجة الجودة"],
  ["Errors", "Errores", "Erreurs", "Fehler", "Erros", "错误", "エラー", "오류", "त्रुटियाँ", "الأخطاء"],
  ["Warnings", "Advertencias", "Avertissements", "Warnungen", "Avisos", "警告", "警告", "경고", "चेतावनियाँ", "التحذيرات"],
  ["Resources", "Recursos", "Ressources", "Ressourcen", "Recursos", "资源", "リソース", "리소스", "संसाधन", "الموارد"],
  ["Resource Cost", "Costo de recursos", "Coût des ressources", "Ressourcenkosten", "Custo dos recursos", "资源成本", "リソース原価", "리소스 비용", "संसाधन लागत", "تكلفة الموارد"],
  ["Estimate Quality", "Calidad de estimación", "Qualité de l’estimation", "Kalkulationsqualität", "Qualidade da estimativa", "估算质量", "見積品質", "견적 품질", "अनुमान गुणवत्ता", "جودة التقدير"],
  ["Not checked", "No revisado", "Non vérifié", "Nicht geprüft", "Não verificado", "未检查", "未確認", "확인 안 됨", "जाँचा नहीं गया", "غير مفحوص"],
  ["Not Run", "No ejecutado", "Non exécuté", "Nicht ausgeführt", "Não executado", "未运行", "未実行", "실행 안 됨", "चलाया नहीं गया", "لم يتم التشغيل"],
  ["Start Review", "Iniciar revisión", "Démarrer la révision", "Prüfung starten", "Iniciar revisão", "开始审核", "レビュー開始", "검토 시작", "समीक्षा शुरू करें", "بدء المراجعة"],
  ["Re-run Review", "Volver a ejecutar revisión", "Relancer la révision", "Prüfung erneut ausführen", "Executar revisão novamente", "重新运行审核", "レビューを再実行", "검토 다시 실행", "समीक्षा पुनः चलाएँ", "إعادة تشغيل المراجعة"],
  ["Running", "Ejecutando", "En cours", "Läuft", "Executando", "运行中", "実行中", "실행 중", "चल रहा है", "قيد التشغيل"],
  ["Complete", "Completo", "Terminé", "Abgeschlossen", "Concluído", "完成", "完了", "완료", "पूर्ण", "مكتمل"],
  ["Failed", "Falló", "Échec", "Fehlgeschlagen", "Falhou", "失败", "失敗", "실패", "विफल", "فشل"],
  ["Outdated", "Desactualizado", "Obsolète", "Veraltet", "Desatualizado", "已过期", "期限切れ", "오래됨", "पुराना", "قديم"],
  ["Mark Current", "Marcar actual", "Marquer actuel", "Als aktuell markieren", "Marcar como atual", "标记为当前", "現在としてマーク", "현재로 표시", "वर्तमान चिह्नित करें", "وضع علامة كحالي"],
  ["Reopen Review", "Reabrir revisión", "Rouvrir la révision", "Prüfung erneut öffnen", "Reabrir revisão", "重新打开审核", "レビューを再開", "검토 다시 열기", "समीक्षा फिर खोलें", "إعادة فتح المراجعة"],
  ["Resolve Review", "Resolver revisión", "Résoudre la révision", "Prüfung lösen", "Resolver revisão", "解决审核", "レビューを解決", "검토 해결", "समीक्षा समाधान करें", "حل المراجعة"],
  ["Done Editing", "Edición terminada", "Modification terminée", "Bearbeitung abgeschlossen", "Edição concluída", "完成编辑", "編集完了", "편집 완료", "संपादन पूर्ण", "تم التحرير"],
  ["Edit Review", "Editar revisión", "Modifier la révision", "Prüfung bearbeiten", "Editar revisão", "编辑审核", "レビューを編集", "검토 편집", "समीक्षा संपादित करें", "تعديل المراجعة"],
  ["Phase Register", "Registro de fases", "Registre des phases", "Phasenregister", "Registro de fases", "阶段登记", "フェーズ台帳", "단계 등록부", "चरण रजिस्टर", "سجل المراحل"],
  ["Add phase", "Agregar fase", "Ajouter une phase", "Phase hinzufügen", "Adicionar fase", "添加阶段", "フェーズを追加", "단계 추가", "चरण जोड़ें", "إضافة مرحلة"],
  ["No phases defined", "No hay fases definidas", "Aucune phase définie", "Keine Phasen definiert", "Nenhuma fase definida", "未定义阶段", "フェーズが定義されていません", "정의된 단계가 없습니다", "कोई चरण परिभाषित नहीं", "لا توجد مراحل محددة"],
  ["Value", "Valor", "Valeur", "Wert", "Valor", "值", "値", "값", "मूल्य", "القيمة"],
  ["Number", "Número", "Numéro", "Nummer", "Número", "编号", "番号", "번호", "संख्या", "الرقم"],
  ["Name", "Nombre", "Nom", "Name", "Nome", "名称", "名前", "이름", "नाम", "الاسم"],
  ["Parent", "Padre", "Parent", "Übergeordnet", "Pai", "父级", "親", "상위", "मूल", "الأصل"],
  ["Order", "Orden", "Ordre", "Reihenfolge", "Ordem", "顺序", "順序", "순서", "क्रम", "الترتيب"],
  ["Start", "Inicio", "Début", "Start", "Início", "开始", "開始", "시작", "प्रारंभ", "البداية"],
  ["End", "Fin", "Fin", "Ende", "Fim", "结束", "終了", "종료", "अंत", "النهاية"],
  ["Color", "Color", "Couleur", "Farbe", "Cor", "颜色", "色", "색상", "रंग", "اللون"],
  ["Child", "Hijo", "Enfant", "Unterphase", "Filho", "子级", "子", "하위", "उप-चरण", "فرعي"],
  ["Delete", "Eliminar", "Supprimer", "Löschen", "Excluir", "删除", "削除", "삭제", "हटाएँ", "حذف"],
  ["Close", "Cerrar", "Fermer", "Schließen", "Fechar", "关闭", "閉じる", "닫기", "बंद करें", "إغلاق"],
  ["Create", "Crear", "Créer", "Erstellen", "Criar", "创建", "作成", "만들기", "बनाएँ", "إنشاء"],
  ["Update", "Actualizar", "Mettre à jour", "Aktualisieren", "Atualizar", "更新", "更新", "업데이트", "अपडेट करें", "تحديث"],
  ["Apply", "Aplicar", "Appliquer", "Anwenden", "Aplicar", "应用", "適用", "적용", "लागू करें", "تطبيق"],
  ["Import", "Importar", "Importer", "Importieren", "Importar", "导入", "インポート", "가져오기", "आयात करें", "استيراد"],
  ["Generate", "Generar", "Générer", "Erzeugen", "Gerar", "生成", "生成", "생성", "बनाएँ", "إنشاء"],
  ["Done", "Listo", "Terminé", "Fertig", "Concluído", "完成", "完了", "완료", "हो गया", "تم"],
  ["Working...", "Trabajando...", "Traitement...", "Wird verarbeitet...", "Processando...", "正在处理...", "処理中...", "작업 중...", "काम जारी है...", "جارٍ العمل..."],
  ["Creating...", "Creando...", "Création...", "Erstellung...", "Criando...", "正在创建...", "作成中...", "생성 중...", "बनाया जा रहा है...", "جارٍ الإنشاء..."],
  ["Deleting...", "Eliminando...", "Suppression...", "Löschen...", "Excluindo...", "正在删除...", "削除中...", "삭제 중...", "हटाया जा रहा है...", "جارٍ الحذف..."],
  ["Deleting…", "Eliminando…", "Suppression…", "Löschen…", "Excluindo…", "正在删除…", "削除中…", "삭제 중…", "हटाया जा रहा है…", "جارٍ الحذف…"],
  ["Applying…", "Aplicando…", "Application…", "Anwenden…", "Aplicando…", "正在应用…", "適用中…", "적용 중…", "लागू किया जा रहा है…", "جارٍ التطبيق…"],
  ["Search", "Buscar", "Rechercher", "Suchen", "Buscar", "搜索", "検索", "검색", "खोजें", "بحث"],
  ["Description", "Descripción", "Description", "Beschreibung", "Descrição", "描述", "説明", "설명", "विवरण", "الوصف"],
  ["Number", "Número", "Numéro", "Nummer", "Número", "编号", "番号", "번호", "संख्या", "الرقم"],
  ["Code", "Código", "Code", "Code", "Código", "代码", "コード", "코드", "कोड", "الرمز"],
  ["Impact", "Impacto", "Impact", "Auswirkung", "Impacto", "影响", "影響", "영향", "प्रभाव", "الأثر"],
  ["Percent", "Porcentaje", "Pourcentage", "Prozent", "Percentual", "百分比", "パーセント", "퍼센트", "प्रतिशत", "النسبة"],
  ["Markup", "Margen aplicado", "Majoration", "Aufschlag", "Markup", "加价", "マークアップ", "마크업", "मार्कअप", "الزيادة"],
  ["Margin", "Margen", "Marge", "Marge", "Margem", "利润率", "マージン", "마진", "मार्जिन", "الهامش"],
  ["Quantity", "Cantidad", "Quantité", "Menge", "Quantidade", "数量", "数量", "수량", "मात्रा", "الكمية"],
  ["Qty", "Cant.", "Qté", "Menge", "Qtd.", "数量", "数量", "수량", "मात्रा", "الكمية"],
  ["Unit", "Unidad", "Unité", "Einheit", "Unidade", "单位", "単位", "단위", "इकाई", "الوحدة"],
  ["Price", "Precio", "Prix", "Preis", "Preço", "价格", "価格", "가격", "मूल्य", "السعر"],
  ["Labor", "Mano de obra", "Main-d’œuvre", "Arbeit", "Mão de obra", "人工", "労務", "노무", "श्रम", "العمالة"],
  ["Material", "Material", "Matériel", "Material", "Material", "材料", "材料", "자재", "सामग्री", "المواد"],
  ["Equipment", "Equipo", "Équipement", "Geräte", "Equipamento", "设备", "設備", "장비", "उपकरण", "المعدات"],
  ["Subcontract", "Subcontrato", "Sous-traitance", "Nachunternehmer", "Subcontrato", "分包", "外注", "외주", "उपठेका", "مقاولة فرعية"],
  ["Travel", "Viaje", "Déplacement", "Reise", "Deslocamento", "差旅", "移動", "이동", "यात्रा", "السفر"],
  ["Line", "Línea", "Ligne", "Zeile", "Linha", "行", "行", "라인", "लाइन", "السطر"],
  ["Item", "Partida", "Article", "Position", "Item", "项目", "項目", "항목", "आइटम", "البند"],
  ["Total", "Total", "Total", "Summe", "Total", "总计", "合計", "합계", "कुल", "الإجمالي"],
  ["Subtotal", "Subtotal", "Sous-total", "Zwischensumme", "Subtotal", "小计", "小計", "소계", "उप-योग", "المجموع الفرعي"],
  ["Source", "Origen", "Source", "Quelle", "Origem", "来源", "ソース", "소스", "स्रोत", "المصدر"],
  ["Source ID", "ID de origen", "ID source", "Quell-ID", "ID da origem", "来源 ID", "ソースID", "소스 ID", "स्रोत ID", "معرّف المصدر"],
  ["Evidence", "Evidencia", "Preuve", "Nachweis", "Evidência", "证据", "根拠", "증거", "साक्ष्य", "الدليل"],
  ["Locator", "Localizador", "Repère", "Locator", "Localizador", "定位器", "ロケーター", "위치 정보", "लोकेटर", "المحدد"],
  ["Tags", "Etiquetas", "Étiquettes", "Tags", "Tags", "标签", "タグ", "태그", "टैग", "الوسوم"],
  ["Apply As", "Aplicar como", "Appliquer comme", "Anwenden als", "Aplicar como", "应用为", "適用形式", "적용 방식", "इस रूप में लागू करें", "تطبيق كـ"],
  ["Formula", "Fórmula", "Formule", "Formel", "Fórmula", "公式", "数式", "수식", "सूत्र", "الصيغة"],
  ["Confidence", "Confianza", "Confiance", "Vertrauen", "Confiança", "置信度", "信頼度", "신뢰도", "विश्वास", "الثقة"],
  ["Active", "Activo", "Actif", "Aktiv", "Ativo", "启用", "有効", "활성", "सक्रिय", "نشط"],
  ["Add to Library", "Agregar a la biblioteca", "Ajouter à la bibliothèque", "Zur Bibliothek hinzufügen", "Adicionar à biblioteca", "添加到库", "ライブラリに追加", "라이브러리에 추가", "लाइब्रेरी में जोड़ें", "إضافة إلى المكتبة"],
  ["Create an organization reusable factor.", "Crear un factor reutilizable de la organización.", "Créer un facteur réutilisable pour l’organisation.", "Einen wiederverwendbaren Organisationsfaktor erstellen.", "Criar um fator reutilizável da organização.", "创建组织可复用系数。", "組織で再利用できる係数を作成します。", "조직에서 재사용할 수 있는 계수를 만듭니다.", "संगठन के लिए पुन: उपयोग योग्य कारक बनाएँ।", "إنشاء عامل قابل لإعادة الاستخدام للمؤسسة."],
  ["Book-backed productivity factors and organization standards.", "Factores de productividad respaldados por libros y estándares de la organización.", "Facteurs de productivité issus des livres et normes de l’organisation.", "Buchgestützte Produktivitätsfaktoren und Organisationsstandards.", "Fatores de produtividade baseados em livros e padrões da organização.", "基于费率书的生产率系数和组织标准。", "ブックに基づく生産性係数と組織標準。", "책 기반 생산성 계수와 조직 표준입니다.", "बुक-आधारित उत्पादकता कारक और संगठन मानक।", "عوامل إنتاجية مدعومة بالدفاتر ومعايير المؤسسة."],
  ["Search factors", "Buscar factores", "Rechercher des facteurs", "Faktoren suchen", "Buscar fatores", "搜索系数", "係数を検索", "계수 검색", "कारक खोजें", "البحث عن العوامل"],
  ["No matching library factors", "No hay factores de biblioteca coincidentes", "Aucun facteur de bibliothèque correspondant", "Keine passenden Bibliotheksfaktoren", "Nenhum fator de biblioteca correspondente", "没有匹配的库系数", "一致するライブラリ係数がありません", "일치하는 라이브러리 계수가 없습니다", "मेल खाते लाइब्रेरी कारक नहीं हैं", "لا توجد عوامل مكتبة مطابقة"],
  ["Global factors change the estimate production model before rollups, summaries, and quote-level adjustments. Line factors stay in the worksheet column.", "Los factores globales cambian el modelo de producción antes de acumulados, resúmenes y ajustes de cotización. Los factores de línea permanecen en la columna de la hoja.", "Les facteurs globaux modifient le modèle de production avant les regroupements, résumés et ajustements de devis. Les facteurs de ligne restent dans la colonne de la feuille.", "Globale Faktoren ändern das Produktionsmodell vor Rollups, Zusammenfassungen und Angebotsanpassungen. Zeilenfaktoren bleiben in der Arbeitsblattspalte.", "Fatores globais alteram o modelo de produção antes de consolidações, resumos e ajustes da cotação. Fatores de linha ficam na coluna da planilha.", "全局系数会在汇总、摘要和报价级调整前改变估算生产模型。行系数保留在工作表列中。", "グローバル係数はロールアップ、要約、見積レベル調整の前に生産モデルを変更します。行係数はワークシート列に残ります。", "전역 계수는 롤업, 요약, 견적 수준 조정 전에 생산 모델을 변경합니다. 라인 계수는 워크시트 열에 남습니다.", "ग्लोबल कारक रोलअप, सारांश और कोटेशन-स्तर समायोजन से पहले उत्पादन मॉडल बदलते हैं। लाइन कारक वर्कशीट कॉलम में रहते हैं।", "تغيّر العوامل العامة نموذج إنتاج التقدير قبل التجميعات والملخصات وتعديلات عرض السعر. تبقى عوامل السطر في عمود ورقة العمل."],
  ["Use a library factor or create a custom factor", "Usa un factor de biblioteca o crea uno personalizado", "Utilisez un facteur de bibliothèque ou créez un facteur personnalisé", "Bibliotheksfaktor verwenden oder eigenen Faktor erstellen", "Use um fator da biblioteca ou crie um fator personalizado", "使用库系数或创建自定义系数", "ライブラリ係数を使用するかカスタム係数を作成", "라이브러리 계수를 사용하거나 사용자 지정 계수를 만드세요", "लाइब्रेरी कारक का उपयोग करें या कस्टम कारक बनाएँ", "استخدم عاملًا من المكتبة أو أنشئ عاملًا مخصصًا"],
  ["Factor", "Factor", "Facteur", "Faktor", "Fator", "系数", "係数", "계수", "कारक", "العامل"],
  ["Mult.", "Mult.", "Mult.", "Mult.", "Mult.", "倍数", "倍率", "배수", "गुणक", "المضاعف"],
  ["Delta", "Delta", "Delta", "Delta", "Delta", "差值", "差分", "델타", "डेल्टा", "دلتا"],
  ["Phase Register", "Registro de fases", "Registre des phases", "Phasenregister", "Registro de fases", "阶段登记", "フェーズ登録", "단계 등록부", "चरण रजिस्टर", "سجل المراحل"],
  ["No phases defined", "No hay fases definidas", "Aucune phase définie", "Keine Phasen definiert", "Nenhuma fase definida", "未定义阶段", "フェーズが定義されていません", "정의된 단계가 없습니다", "कोई चरण परिभाषित नहीं", "لا توجد مراحل محددة"],
  ["Phase", "Fase", "Phase", "Phase", "Fase", "阶段", "フェーズ", "단계", "चरण", "المرحلة"],
  ["Value", "Valor", "Valeur", "Wert", "Valor", "值", "値", "값", "मान", "القيمة"],
  ["Drag up/down to reorder; drag right to indent or left to outdent", "Arrastra arriba/abajo para reordenar; a la derecha para indentar o a la izquierda para quitar sangría", "Glissez haut/bas pour réordonner; à droite pour indenter ou à gauche pour désindenter", "Nach oben/unten ziehen zum Sortieren; nach rechts einrücken oder nach links ausrücken", "Arraste para cima/baixo para reordenar; à direita para indentar ou à esquerda para remover recuo", "上下拖动重新排序；向右缩进或向左减少缩进", "上下にドラッグして並べ替え、右でインデント、左で解除", "위/아래로 끌어 순서를 바꾸고 오른쪽으로 들여쓰기, 왼쪽으로 내어쓰기", "क्रम बदलने के लिए ऊपर/नीचे खींचें; दाएँ इंडेंट, बाएँ आउटडेंट", "اسحب للأعلى/للأسفل لإعادة الترتيب؛ لليمين للمسافة البادئة أو لليسار للإخراج"],
  ["Drag phase", "Arrastrar fase", "Glisser la phase", "Phase ziehen", "Arrastar fase", "拖动阶段", "フェーズをドラッグ", "단계 끌기", "चरण खींचें", "سحب المرحلة"],
  ["Add child phase", "Agregar fase hija", "Ajouter une phase enfant", "Unterphase hinzufügen", "Adicionar fase filha", "添加子阶段", "子フェーズを追加", "하위 단계 추가", "उप-चरण जोड़ें", "إضافة مرحلة فرعية"],
  ["Edit phase", "Editar fase", "Modifier la phase", "Phase bearbeiten", "Editar fase", "编辑阶段", "フェーズを編集", "단계 편집", "चरण संपादित करें", "تعديل المرحلة"],
  ["Delete phase", "Eliminar fase", "Supprimer la phase", "Phase löschen", "Excluir fase", "删除阶段", "フェーズを削除", "단계 삭제", "चरण हटाएँ", "حذف المرحلة"],
  ["Compare drawing revisions", "Comparar revisiones de planos", "Comparer les révisions de dessins", "Zeichnungsrevisionen vergleichen", "Comparar revisões de desenhos", "比较图纸修订", "図面リビジョンを比較", "도면 개정 비교", "ड्रॉइंग संशोधनों की तुलना करें", "مقارنة مراجعات الرسومات"],
  ["Base revision", "Revisión base", "Révision de base", "Basisrevision", "Revisão base", "基础修订", "ベースリビジョン", "기준 개정", "आधार संशोधन", "المراجعة الأساسية"],
  ["Head revision", "Revisión destino", "Révision cible", "Zielrevision", "Revisão principal", "目标修订", "ヘッドリビジョン", "대상 개정", "हेड संशोधन", "مراجعة الرأس"],
  ["Pick a base and head revision to see what changed.", "Elige una revisión base y destino para ver los cambios.", "Choisissez une révision de base et une révision cible pour voir les changements.", "Wählen Sie Basis- und Zielrevision, um Änderungen zu sehen.", "Escolha uma revisão base e principal para ver o que mudou.", "选择基础和目标修订以查看更改。", "変更内容を見るにはベースとヘッドのリビジョンを選択してください。", "변경 내용을 보려면 기준 및 대상 개정을 선택하세요.", "क्या बदला है देखने के लिए आधार और हेड संशोधन चुनें।", "اختر مراجعة أساسية ورأسية لمعرفة ما تغيّر."],
  ["Change", "Cambio", "Changement", "Änderung", "Alteração", "更改", "変更", "변경", "बदलाव", "التغيير"],
  ["Element", "Elemento", "Élément", "Element", "Elemento", "元素", "要素", "요소", "तत्व", "العنصر"],
  ["Linked item", "Partida vinculada", "Article lié", "Verknüpfte Position", "Item vinculado", "已链接项目", "リンク済み項目", "연결된 항목", "लिंक किया आइटम", "البند المرتبط"],
  ["Old qty", "Cant. anterior", "Ancienne qté", "Alte Menge", "Qtd. antiga", "旧数量", "旧数量", "이전 수량", "पुरानी मात्रा", "الكمية القديمة"],
  ["New qty", "Cant. nueva", "Nouvelle qté", "Neue Menge", "Qtd. nova", "新数量", "新数量", "새 수량", "नई मात्रा", "الكمية الجديدة"],
  ["Cost Δ", "Δ costo", "Δ coût", "Kosten Δ", "Δ custo", "成本 Δ", "原価 Δ", "비용 Δ", "लागत Δ", "فرق التكلفة"],
  ["PDF Studio", "Estudio PDF", "Studio PDF", "PDF-Studio", "Estúdio PDF", "PDF 工作室", "PDFスタジオ", "PDF 스튜디오", "PDF स्टूडियो", "استوديو PDF"],
  ["Document Builder", "Generador de documentos", "Générateur de documents", "Dokumentgenerator", "Criador de documentos", "文档生成器", "ドキュメントビルダー", "문서 빌더", "दस्तावेज़ बिल्डर", "منشئ المستندات"],
  ["Loading preferences...", "Cargando preferencias...", "Chargement des préférences...", "Einstellungen werden geladen...", "Carregando preferências...", "正在加载偏好设置...", "設定を読み込み中...", "환경 설정 로드 중...", "प्राथमिकताएँ लोड हो रही हैं...", "جارٍ تحميل التفضيلات..."],
  ["Document Type", "Tipo de documento", "Type de document", "Dokumenttyp", "Tipo de documento", "文档类型", "ドキュメント種別", "문서 유형", "दस्तावेज़ प्रकार", "نوع المستند"],
  ["Customer-Facing Output", "Salida para cliente", "Sortie destinée au client", "Kundenausgabe", "Saída para cliente", "面向客户的输出", "顧客向け出力", "고객용 출력", "ग्राहक हेतु आउटपुट", "مخرجات موجهة للعميل"],
  ["Hide internal cost, markup, margin, and profit", "Ocultar costo interno, markup, margen y ganancia", "Masquer coût interne, majoration, marge et profit", "Interne Kosten, Aufschlag, Marge und Gewinn ausblenden", "Ocultar custo interno, markup, margem e lucro", "隐藏内部成本、加价、利润率和利润", "内部原価、マークアップ、マージン、利益を非表示", "내부 비용, 마크업, 마진, 이익 숨기기", "आंतरिक लागत, मार्कअप, मार्जिन और लाभ छिपाएँ", "إخفاء التكلفة الداخلية والزيادة والهامش والربح"],
  ["Page Setup", "Configuración de página", "Mise en page", "Seiteneinrichtung", "Configuração de página", "页面设置", "ページ設定", "페이지 설정", "पृष्ठ सेटअप", "إعداد الصفحة"],
  ["Orientation", "Orientación", "Orientation", "Ausrichtung", "Orientação", "方向", "向き", "방향", "ओरिएंटेशन", "الاتجاه"],
  ["Page Size", "Tamaño de página", "Format de page", "Seitengröße", "Tamanho da página", "页面大小", "ページサイズ", "페이지 크기", "पृष्ठ आकार", "حجم الصفحة"],
  ["Show Cost Column", "Mostrar columna de costo", "Afficher la colonne coût", "Kostenspalte anzeigen", "Mostrar coluna de custo", "显示成本列", "原価列を表示", "비용 열 표시", "लागत कॉलम दिखाएँ", "إظهار عمود التكلفة"],
  ["Show Markup Column", "Mostrar columna de markup", "Afficher la colonne majoration", "Aufschlagspalte anzeigen", "Mostrar coluna de markup", "显示加价列", "マークアップ列を表示", "마크업 열 표시", "मार्कअप कॉलम दिखाएँ", "إظهار عمود الزيادة"],
  ["Group By", "Agrupar por", "Regrouper par", "Gruppieren nach", "Agrupar por", "分组依据", "グループ化", "그룹 기준", "इसके अनुसार समूहित करें", "تجميع حسب"],
  ["Show Organization Logo", "Mostrar logo de la organización", "Afficher le logo de l’organisation", "Organisationslogo anzeigen", "Mostrar logotipo da organização", "显示组织徽标", "組織ロゴを表示", "조직 로고 표시", "संगठन लोगो दिखाएँ", "إظهار شعار المؤسسة"],
  ["Cover Background", "Fondo de portada", "Arrière-plan de couverture", "Deckblatthintergrund", "Fundo da capa", "封面背景", "表紙背景", "표지 배경", "कवर पृष्ठभूमि", "خلفية الغلاف"],
  ["Custom Sections", "Secciones personalizadas", "Sections personnalisées", "Benutzerdefinierte Abschnitte", "Seções personalizadas", "自定义部分", "カスタムセクション", "사용자 지정 섹션", "कस्टम अनुभाग", "أقسام مخصصة"],
  ["Section title", "Título de sección", "Titre de section", "Abschnittstitel", "Título da seção", "部分标题", "セクションタイトル", "섹션 제목", "अनुभाग शीर्षक", "عنوان القسم"],
  ["Section content...", "Contenido de sección...", "Contenu de section...", "Abschnittsinhalt...", "Conteúdo da seção...", "部分内容...", "セクション内容...", "섹션 내용...", "अनुभाग सामग्री...", "محتوى القسم..."],
  ["Branding", "Marca", "Image de marque", "Branding", "Marca", "品牌", "ブランディング", "브랜딩", "ब्रांडिंग", "الهوية"],
  ["Accent Color", "Color de acento", "Couleur d’accent", "Akzentfarbe", "Cor de destaque", "强调色", "アクセント色", "강조 색상", "एक्सेंट रंग", "لون التمييز"],
  ["Header Background", "Fondo de encabezado", "Arrière-plan d’en-tête", "Kopfzeilenhintergrund", "Fundo do cabeçalho", "页眉背景", "ヘッダー背景", "헤더 배경", "हेडर पृष्ठभूमि", "خلفية الرأس"],
  ["Font", "Fuente", "Police", "Schriftart", "Fonte", "字体", "フォント", "글꼴", "फ़ॉन्ट", "الخط"],
  ["Header & Footer", "Encabezado y pie", "En-tête et pied de page", "Kopf- und Fußzeile", "Cabeçalho e rodapé", "页眉和页脚", "ヘッダーとフッター", "머리글 및 바닥글", "हेडर और फुटर", "الرأس والتذييل"],
  ["Show Header", "Mostrar encabezado", "Afficher l’en-tête", "Kopfzeile anzeigen", "Mostrar cabeçalho", "显示页眉", "ヘッダーを表示", "머리글 표시", "हेडर दिखाएँ", "إظهار الرأس"],
  ["Show Footer", "Mostrar pie", "Afficher le pied de page", "Fußzeile anzeigen", "Mostrar rodapé", "显示页脚", "フッターを表示", "바닥글 표시", "फुटर दिखाएँ", "إظهار التذييل"],
  ["Page Numbers", "Números de página", "Numéros de page", "Seitennummern", "Números de página", "页码", "ページ番号", "페이지 번호", "पृष्ठ संख्याएँ", "أرقام الصفحات"],
  ["Save PDF preferences for this quote", "Guardar preferencias PDF para esta cotización", "Enregistrer les préférences PDF pour ce devis", "PDF-Einstellungen für dieses Angebot speichern", "Salvar preferências de PDF para esta cotação", "保存此报价的 PDF 偏好设置", "この見積のPDF設定を保存", "이 견적의 PDF 환경설정 저장", "इस कोटेशन के लिए PDF प्राथमिकताएँ सहेजें", "حفظ تفضيلات PDF لهذا العرض"],
  ["Unsaved changes (auto-saves in 2s)", "Cambios sin guardar (guardado automático en 2 s)", "Changements non enregistrés (auto-enregistrement dans 2 s)", "Ungespeicherte Änderungen (Autospeichern in 2 s)", "Alterações não salvas (salva automaticamente em 2s)", "未保存更改（2 秒后自动保存）", "未保存の変更（2秒で自動保存）", "저장되지 않은 변경 사항(2초 후 자동 저장)", "असहेजे बदलाव (2 सेकंड में स्वतः सहेजता है)", "تغييرات غير محفوظة (حفظ تلقائي خلال ثانيتين)"],
  ["Live Preview", "Vista previa en vivo", "Aperçu en direct", "Live-Vorschau", "Prévia ao vivo", "实时预览", "ライブプレビュー", "실시간 미리보기", "लाइव पूर्वावलोकन", "معاينة مباشرة"],
  ["Open Detail", "Abrir detalle", "Ouvrir le détail", "Details öffnen", "Abrir detalhes", "打开详情", "詳細を開く", "세부 정보 열기", "विवरण खोलें", "فتح التفاصيل"],
  ["Search rates, catalogues, labour units, assemblies, cost intel, plugins...", "Buscar tarifas, catálogos, unidades de mano de obra, ensamblajes, inteligencia de costos y plugins...", "Rechercher taux, catalogues, unités de main-d’œuvre, assemblages, infos coûts et modules...", "Sätze, Kataloge, Arbeitseinheiten, Baugruppen, Kosteninfos und Plugins suchen...", "Buscar taxas, catálogos, unidades de mão de obra, montagens, inteligência de custos e plugins...", "搜索费率、目录、人工单位、组件、成本情报和插件...", "レート、カタログ、労務単位、アセンブリ、コスト情報、プラグインを検索...", "요율, 카탈로그, 노무 단위, 어셈블리, 비용 정보, 플러그인 검색...", "दरें, कैटलॉग, श्रम इकाइयाँ, असेंबली, लागत इंटेल और प्लगइन खोजें...", "ابحث في الأسعار والكتالوجات ووحدات العمالة والتجميعات ومعلومات التكلفة والمكونات الإضافية..."],
  ["End of indexed results", "Fin de resultados indexados", "Fin des résultats indexés", "Ende der indexierten Ergebnisse", "Fim dos resultados indexados", "索引结果已到底", "インデックス結果の終わり", "색인 결과 끝", "अनुक्रमित परिणाम समाप्त", "نهاية النتائج المفهرسة"],
  ["Add Selected", "Agregar seleccionados", "Ajouter la sélection", "Ausgewählte hinzufügen", "Adicionar selecionados", "添加所选项", "選択項目を追加", "선택 항목 추가", "चयनित जोड़ें", "إضافة المحدد"],
  ["Search worksheets...", "Buscar hojas...", "Rechercher des feuilles...", "Arbeitsblätter suchen...", "Buscar planilhas...", "搜索工作表...", "ワークシートを検索...", "워크시트 검색...", "वर्कशीट खोजें...", "البحث في أوراق العمل..."],
  ["Search line-capable factors", "Buscar factores aplicables a líneas", "Rechercher des facteurs applicables aux lignes", "Zeilenfähige Faktoren suchen", "Buscar fatores aplicáveis a linhas", "搜索可用于行的系数", "行対応係数を検索", "라인 적용 가능 계수 검색", "लाइन-सक्षम कारक खोजें", "البحث عن عوامل مناسبة للبنود"],
  ["Takeoff Marks", "Marcas de medición", "Marques de métré", "Aufmaßmarkierungen", "Marcas de levantamento", "算量标记", "拾い出しマーク", "물량 산출 마크", "टेकऑफ चिह्न", "علامات الحصر"],
  ["Link to Line Item", "Vincular a partida", "Lier à une ligne", "Mit Position verknüpfen", "Vincular ao item", "链接到明细项", "明細行にリンク", "라인 항목에 연결", "लाइन आइटम से लिंक", "ربط بالبند"],
  ["Add Line Items", "Agregar partidas", "Ajouter des lignes", "Positionen hinzufügen", "Adicionar itens", "添加明细项", "明細行を追加", "라인 항목 추가", "लाइन आइटम जोड़ें", "إضافة بنود"],
  ["3D Takeoff Model", "Modelo de medición 3D", "Modèle de métré 3D", "3D-Aufmaßmodell", "Modelo de levantamento 3D", "3D 算量模型", "3D拾い出しモデル", "3D 물량 산출 모델", "3D टेकऑफ मॉडल", "نموذج حصر ثلاثي الأبعاد"],
  ["All drawings", "Todos los planos", "Tous les dessins", "Alle Zeichnungen", "Todos os desenhos", "所有图纸", "すべての図面", "모든 도면", "सभी ड्रॉइंग", "كل الرسومات"],
  ["All PDFs", "Todos los PDF", "Tous les PDF", "Alle PDFs", "Todos os PDFs", "所有 PDF", "すべてのPDF", "모든 PDF", "सभी PDF", "كل ملفات PDF"],
  ["All Pages", "Todas las páginas", "Toutes les pages", "Alle Seiten", "Todas as páginas", "所有页面", "すべてのページ", "모든 페이지", "सभी पृष्ठ", "كل الصفحات"],
  ["Choose intake source", "Elegir origen de ingreso", "Choisir la source d’intake", "Erfassungsquelle auswählen", "Escolher fonte de entrada", "选择录入来源", "取り込みソースを選択", "접수 소스 선택", "इंटेक स्रोत चुनें", "اختر مصدر الإدخال"],
  ["Open Current Source", "Abrir origen actual", "Ouvrir la source actuelle", "Aktuelle Quelle öffnen", "Abrir origem atual", "打开当前来源", "現在のソースを開く", "현재 소스 열기", "वर्तमान स्रोत खोलें", "فتح المصدر الحالي"],
  ["Open Documents", "Abrir documentos", "Ouvrir les documents", "Dokumente öffnen", "Abrir documentos", "打开文档", "ドキュメントを開く", "문서 열기", "दस्तावेज़ खोलें", "فتح المستندات"],
  ["Open Tool Library", "Abrir biblioteca de herramientas", "Ouvrir la bibliothèque d’outils", "Werkzeugbibliothek öffnen", "Abrir biblioteca de ferramentas", "打开工具库", "ツールライブラリを開く", "도구 라이브러리 열기", "टूल लाइब्रेरी खोलें", "فتح مكتبة الأدوات"],
  ["Open in Chat", "Abrir en chat", "Ouvrir dans le clavardage", "Im Chat öffnen", "Abrir no chat", "在聊天中打开", "チャットで開く", "채팅에서 열기", "चैट में खोलें", "فتح في الدردشة"],
  ["Open in new window", "Abrir en ventana nueva", "Ouvrir dans une nouvelle fenêtre", "In neuem Fenster öffnen", "Abrir em nova janela", "在新窗口打开", "新しいウィンドウで開く", "새 창에서 열기", "नई विंडो में खोलें", "فتح في نافذة جديدة"],
  ["Line Sell Subtotal", "Subtotal de venta de líneas", "Sous-total de vente des lignes", "Zeilen-Verkaufszwischensumme", "Subtotal de venda das linhas", "明细销售小计", "行売価小計", "라인 판매 소계", "लाइन विक्रय उप-योग", "المجموع الفرعي لبيع البنود"],
  ["Search resources, vendors, phases", "Buscar recursos, proveedores, fases", "Rechercher ressources, fournisseurs, phases", "Ressourcen, Anbieter, Phasen suchen", "Buscar recursos, fornecedores, fases", "搜索资源、供应商、阶段", "リソース、ベンダー、フェーズを検索", "리소스, 공급업체, 단계 검색", "संसाधन, विक्रेता, चरण खोजें", "البحث في الموارد والمورّدين والمراحل"],
  ["3D Model", "Modelo 3D", "Modèle 3D", "3D-Modell", "Modelo 3D", "3D 模型", "3Dモデル", "3D 모델", "3D मॉडल", "نموذج ثلاثي الأبعاد"],
  ["3D surface area", "Área de superficie 3D", "Surface 3D", "3D-Oberfläche", "Área de superfície 3D", "3D 表面积", "3D表面積", "3D 표면적", "3D सतह क्षेत्र", "مساحة سطح ثلاثية الأبعاد"],
  ["3D volume", "Volumen 3D", "Volume 3D", "3D-Volumen", "Volume 3D", "3D 体积", "3D体積", "3D 부피", "3D आयतन", "حجم ثلاثي الأبعاد"],
  ["3D selected elements", "Elementos 3D seleccionados", "Éléments 3D sélectionnés", "Ausgewählte 3D-Elemente", "Elementos 3D selecionados", "选定 3D 元素", "選択した3D要素", "선택한 3D 요소", "चयनित 3D तत्व", "العناصر ثلاثية الأبعاد المحددة"],
  ["3D model object", "Objeto de modelo 3D", "Objet de modèle 3D", "3D-Modellobjekt", "Objeto do modelo 3D", "3D 模型对象", "3Dモデルオブジェクト", "3D 모델 객체", "3D मॉडल ऑब्जेक्ट", "كائن نموذج ثلاثي الأبعاد"],
  ["Applied Factors", "Factores aplicados", "Facteurs appliqués", "Angewendete Faktoren", "Fatores aplicados", "已应用系数", "適用済み係数", "적용된 계수", "लागू कारक", "العوامل المطبقة"],
  ["Global Factors", "Factores globales", "Facteurs globaux", "Globale Faktoren", "Fatores globais", "全局系数", "グローバル係数", "전역 계수", "वैश्विक कारक", "العوامل العامة"],
  ["Before Factors", "Antes de factores", "Avant facteurs", "Vor Faktoren", "Antes dos fatores", "系数前", "係数前", "계수 전", "कारकों से पहले", "قبل العوامل"],
  ["Hour Impact", "Impacto en horas", "Impact sur les heures", "Stundenauswirkung", "Impacto em horas", "工时影响", "時間への影響", "시간 영향", "घंटों पर प्रभाव", "أثر الساعات"],
  ["Sell Impact", "Impacto en venta", "Impact sur la vente", "Verkaufsauswirkung", "Impacto de venda", "销售影响", "売価への影響", "판매 영향", "विक्रय प्रभाव", "أثر البيع"],
  ["Factor Library", "Biblioteca de factores", "Bibliothèque de facteurs", "Faktorbibliothek", "Biblioteca de fatores", "系数库", "係数ライブラリ", "계수 라이브러리", "कारक लाइब्रेरी", "مكتبة العوامل"],
  ["Cost Basis", "Base de costo", "Base de coût", "Kostenbasis", "Base de custo", "成本依据", "原価基準", "비용 기준", "लागत आधार", "أساس التكلفة"],
  ["Cost Intelligence", "Inteligencia de costos", "Info coûts", "Kosteninformationen", "Inteligência de custos", "成本情报", "コスト情報", "비용 정보", "लागत इंटेलिजेंस", "معلومات التكلفة"],
  ["Line Subtotal Only", "Solo subtotal de líneas", "Sous-total des lignes seulement", "Nur Zeilensumme", "Somente subtotal das linhas", "仅明细小计", "行小計のみ", "라인 소계만", "केवल लाइन उप-योग", "المجموع الفرعي للبنود فقط"],
  ["Entire Quote", "Cotización completa", "Devis complet", "Gesamtes Angebot", "Cotação inteira", "整个报价", "見積全体", "전체 견적", "पूरा कोटेशन", "العرض بالكامل"],
  ["Custom Pivot", "Tabla dinámica personalizada", "Tableau croisé personnalisé", "Benutzerdefinierter Pivot", "Pivot personalizado", "自定义透视", "カスタムピボット", "사용자 지정 피벗", "कस्टम पिवट", "جدول محوري مخصص"],
  ["Construction Codes", "Códigos de construcción", "Codes de construction", "Baucodes", "Códigos de construção", "施工代码", "建設コード", "시공 코드", "निर्माण कोड", "أكواد البناء"],
  ["Fixed Allowance", "Asignación fija", "Provision fixe", "Feste Zulage", "Verba fixa", "固定暂列金额", "固定許容額", "고정 허용액", "निश्चित भत्ता", "مخصص ثابت"],
  ["Alternate Add", "Adición alternativa", "Ajout de variante", "Alternative Ergänzung", "Adicional alternativo", "备选增加", "代替追加", "대안 추가", "वैकल्पिक जोड़", "إضافة بديلة"],
  ["New Optional Standalone", "Nuevo opcional independiente", "Nouvelle option autonome", "Neue eigenständige Option", "Novo opcional independente", "新增独立可选项", "新規任意単独項目", "새 선택 독립 항목", "नया वैकल्पिक स्वतंत्र", "اختياري مستقل جديد"],
  ["New Standalone Line Item", "Nueva partida independiente", "Nouvelle ligne autonome", "Neue eigenständige Position", "Novo item independente", "新增独立明细项", "新規単独明細行", "새 독립 라인 항목", "नया स्वतंत्र लाइन आइटम", "بند مستقل جديد"],
  ["Line Thickness", "Grosor de línea", "Épaisseur de ligne", "Linienstärke", "Espessura da linha", "线宽", "線の太さ", "선 두께", "लाइन मोटाई", "سماكة الخط"],
  ["Drop Distance", "Distancia de caída", "Distance de chute", "Abfalldistanz", "Distância de queda", "落差距离", "落差距離", "낙차 거리", "ड्रॉप दूरी", "مسافة الهبوط"],
  ["Wall Height", "Altura de muro", "Hauteur du mur", "Wandhöhe", "Altura da parede", "墙高", "壁の高さ", "벽 높이", "दीवार ऊँचाई", "ارتفاع الجدار"],
  ["Count Interval", "Intervalo de conteo", "Intervalle de comptage", "Zählintervall", "Intervalo de contagem", "计数间距", "カウント間隔", "계수 간격", "गिनती अंतराल", "فاصل العد"],
  ["Measurement Field", "Campo de medición", "Champ de mesure", "Messfeld", "Campo de medição", "测量字段", "測定フィールド", "측정 필드", "माप फ़ील्ड", "حقل القياس"],
  ["Waste / Safety Factor %", "Desperdicio / factor de seguridad %", "Facteur déchets / sécurité %", "Verschnitt-/Sicherheitsfaktor %", "Fator de perda / segurança %", "损耗 / 安全系数 %", "廃棄 / 安全係数 %", "폐기 / 안전 계수 %", "अपशिष्ट / सुरक्षा कारक %", "عامل الهدر / السلامة %"],
  ["Loading more...", "Cargando más...", "Chargement de plus...", "Mehr wird geladen...", "Carregando mais...", "正在加载更多...", "さらに読み込み中...", "더 불러오는 중...", "और लोड हो रहा है...", "جارٍ تحميل المزيد..."],
  ["Generating...", "Generando...", "Génération...", "Wird erzeugt...", "Gerando...", "正在生成...", "生成中...", "생성 중...", "बन रहा है...", "جارٍ الإنشاء..."],
  ["Analyzing region...", "Analizando región...", "Analyse de la zone...", "Bereich wird analysiert...", "Analisando região...", "正在分析区域...", "領域を分析中...", "영역 분석 중...", "क्षेत्र का विश्लेषण हो रहा है...", "جارٍ تحليل المنطقة..."],
  ["Counting symbols in the region…", "Contando símbolos en la región…", "Comptage des symboles dans la zone…", "Symbole im Bereich werden gezählt…", "Contando símbolos na região…", "正在计数区域中的符号…", "領域内の記号をカウント中…", "영역의 기호 계산 중…", "क्षेत्र में प्रतीक गिने जा रहे हैं…", "جارٍ عد الرموز في المنطقة…"],
  ["Asking AI for matching line items…", "Consultando IA para partidas coincidentes…", "Demande à l’IA de lignes correspondantes…", "KI sucht passende Positionen…", "Consultando IA por itens correspondentes…", "正在让 AI 查找匹配明细项…", "AIに一致する明細行を問い合わせ中…", "AI가 일치하는 라인 항목을 찾는 중…", "मिलते लाइन आइटम के लिए AI से पूछ रहे हैं…", "جارٍ سؤال الذكاء الاصطناعي عن البنود المطابقة…"],
  ["AI suggestions", "Sugerencias de IA", "Suggestions IA", "KI-Vorschläge", "Sugestões de IA", "AI 建议", "AI提案", "AI 제안", "AI सुझाव", "اقتراحات الذكاء الاصطناعي"],
  ["No takeoff marks yet", "Aún no hay marcas de medición", "Aucune marque de métré pour l’instant", "Noch keine Aufmaßmarkierungen", "Ainda não há marcas de levantamento", "还没有算量标记", "拾い出しマークはまだありません", "아직 물량 산출 마크가 없습니다", "अभी कोई टेकऑफ चिह्न नहीं", "لا توجد علامات حصر بعد"],
  ["Create line item", "Crear partida", "Créer une ligne", "Position erstellen", "Criar item", "创建明细项", "明細行を作成", "라인 항목 생성", "लाइन आइटम बनाएँ", "إنشاء بند"],
  ["Linked Line Items", "Partidas vinculadas", "Lignes liées", "Verknüpfte Positionen", "Itens vinculados", "已链接明细项", "リンク済み明細行", "연결된 라인 항목", "लिंक किए लाइन आइटम", "البنود المرتبطة"],
  ["Delete linked line item", "Eliminar partida vinculada", "Supprimer la ligne liée", "Verknüpfte Position löschen", "Excluir item vinculado", "删除已链接明细项", "リンク済み明細を削除", "연결된 라인 항목 삭제", "लिंक किया लाइन आइटम हटाएँ", "حذف البند المرتبط"],
  ["Create Object Rows", "Crear filas de objetos", "Créer des lignes d’objets", "Objektzeilen erstellen", "Criar linhas de objeto", "创建对象行", "オブジェクト行を作成", "객체 행 생성", "ऑब्जेक्ट पंक्तियाँ बनाएँ", "إنشاء صفوف كائنات"],
  ["Model Objects", "Objetos del modelo", "Objets du modèle", "Modellobjekte", "Objetos do modelo", "模型对象", "モデルオブジェクト", "모델 객체", "मॉडल ऑब्जेक्ट", "كائنات النموذج"],
  ["Import Spreadsheet/CSV", "Importar hoja de cálculo/CSV", "Importer feuille de calcul/CSV", "Tabellenkalkulation/CSV importieren", "Importar planilha/CSV", "导入电子表格/CSV", "スプレッドシート/CSVをインポート", "스프레드시트/CSV 가져오기", "स्प्रेडशीट/CSV आयात करें", "استيراد جدول بيانات/CSV"],
  ["Import Rows", "Importar filas", "Importer les lignes", "Zeilen importieren", "Importar linhas", "导入行", "行をインポート", "행 가져오기", "पंक्तियाँ आयात करें", "استيراد الصفوف"],
  ["Import Target", "Destino de importación", "Cible d’importation", "Importziel", "Destino da importação", "导入目标", "インポート対象", "가져오기 대상", "आयात लक्ष्य", "هدف الاستيراد"],
  ["Extract From Document", "Extraer desde documento", "Extraire du document", "Aus Dokument extrahieren", "Extrair do documento", "从文档提取", "ドキュメントから抽出", "문서에서 추출", "दस्तावेज़ से निकालें", "استخراج من المستند"],
  ["Use Drawing or Model", "Usar plano o modelo", "Utiliser dessin ou modèle", "Zeichnung oder Modell verwenden", "Usar desenho ou modelo", "使用图纸或模型", "図面またはモデルを使用", "도면 또는 모델 사용", "ड्रॉइंग या मॉडल उपयोग करें", "استخدم رسمًا أو نموذجًا"],
  ["Use Trade Tool", "Usar herramienta de oficio", "Utiliser l’outil métier", "Gewerkzeug verwenden", "Usar ferramenta de disciplina", "使用专业工具", "工種ツールを使用", "공종 도구 사용", "ट्रेड टूल उपयोग करें", "استخدم أداة التخصص"],
  ["Drawing and model sources", "Orígenes de plano y modelo", "Sources dessin et modèle", "Zeichnungs- und Modellquellen", "Fontes de desenho e modelo", "图纸和模型来源", "図面とモデルのソース", "도면 및 모델 소스", "ड्रॉइंग और मॉडल स्रोत", "مصادر الرسم والنموذج"],
  ["Document extraction", "Extracción de documentos", "Extraction de document", "Dokumentextraktion", "Extração de documento", "文档提取", "ドキュメント抽出", "문서 추출", "दस्तावेज़ निष्कर्षण", "استخراج المستند"],
  ["Clear all takeoff marks", "Borrar todas las marcas de medición", "Effacer toutes les marques de métré", "Alle Aufmaßmarkierungen löschen", "Limpar todas as marcas de levantamento", "清除所有算量标记", "すべての拾い出しマークをクリア", "모든 물량 산출 마크 지우기", "सभी टेकऑफ चिह्न साफ़ करें", "مسح كل علامات الحصر"],
  ["Fit to width", "Ajustar al ancho", "Ajuster à la largeur", "An Breite anpassen", "Ajustar à largura", "适合宽度", "幅に合わせる", "너비에 맞춤", "चौड़ाई में फिट करें", "ملاءمة للعرض"],
  ["Fit to page", "Ajustar a página", "Ajuster à la page", "An Seite anpassen", "Ajustar à página", "适合页面", "ページに合わせる", "페이지에 맞춤", "पृष्ठ में फिट करें", "ملاءمة للصفحة"],
  ["Set scale", "Definir escala", "Définir l’échelle", "Maßstab setzen", "Definir escala", "设置比例", "スケールを設定", "축척 설정", "स्केल सेट करें", "تعيين المقياس"],
  ["Set drawing scale", "Definir escala del plano", "Définir l’échelle du dessin", "Zeichnungsmaßstab setzen", "Definir escala do desenho", "设置图纸比例", "図面スケールを設定", "도면 축척 설정", "ड्रॉइंग स्केल सेट करें", "تعيين مقياس الرسم"],
  ["Verify drawing scale", "Verificar escala del plano", "Vérifier l’échelle du dessin", "Zeichnungsmaßstab prüfen", "Verificar escala do desenho", "验证图纸比例", "図面スケールを確認", "도면 축척 확인", "ड्रॉइंग स्केल सत्यापित करें", "التحقق من مقياس الرسم"],
  ["Recalibrate drawing scale", "Recalibrar escala del plano", "Recalibrer l’échelle du dessin", "Zeichnungsmaßstab neu kalibrieren", "Recalibrar escala do desenho", "重新校准图纸比例", "図面スケールを再校正", "도면 축척 재보정", "ड्रॉइंग स्केल पुनः कैलिब्रेट करें", "إعادة معايرة مقياس الرسم"],
  ["Draw a line of known length to verify the calibration", "Dibuja una línea de longitud conocida para verificar la calibración", "Dessinez une ligne de longueur connue pour vérifier le calibrage", "Eine Linie bekannter Länge zeichnen, um die Kalibrierung zu prüfen", "Desenhe uma linha de comprimento conhecido para verificar a calibração", "绘制已知长度的线以验证校准", "既知の長さの線を描いて校正を確認", "알려진 길이의 선을 그려 보정을 확인하세요", "कैलिब्रेशन सत्यापित करने के लिए ज्ञात लंबाई की रेखा खींचें", "ارسم خطًا بطول معروف للتحقق من المعايرة"],
  ["Add Custom Section", "Agregar sección personalizada", "Ajouter une section personnalisée", "Benutzerdefinierten Abschnitt hinzufügen", "Adicionar seção personalizada", "添加自定义章节", "カスタムセクションを追加", "사용자 지정 섹션 추가", "कस्टम अनुभाग जोड़ें", "إضافة قسم مخصص"],
  ["Add sub-section", "Agregar subsección", "Ajouter une sous-section", "Unterabschnitt hinzufügen", "Adicionar subseção", "添加子章节", "サブセクションを追加", "하위 섹션 추가", "उप-अनुभाग जोड़ें", "إضافة قسم فرعي"],
  ["Add one", "Agregar una", "En ajouter une", "Eine hinzufügen", "Adicionar um", "添加一个", "1件追加", "하나 추가", "एक जोड़ें", "إضافة واحد"],
  ["Click to replace", "Haz clic para reemplazar", "Cliquer pour remplacer", "Klicken zum Ersetzen", "Clique para substituir", "点击替换", "クリックして置換", "클릭하여 교체", "बदलने के लिए क्लिक करें", "انقر للاستبدال"],
  ["Click to upload image", "Haz clic para subir imagen", "Cliquer pour téléverser l’image", "Klicken, um Bild hochzuladen", "Clique para enviar imagem", "点击上传图像", "クリックして画像をアップロード", "클릭하여 이미지 업로드", "छवि अपलोड करने के लिए क्लिक करें", "انقر لرفع صورة"],
  ["Enter lead letter content...", "Ingresa contenido de la carta inicial...", "Saisir le contenu de la lettre...", "Anschreibentext eingeben...", "Insira o conteúdo da carta...", "输入引导信内容...", "リードレター内容を入力...", "리드 레터 내용 입력...", "लीड पत्र सामग्री दर्ज करें...", "أدخل محتوى الخطاب التمهيدي..."],
  ["AI - Rewrite Description", "IA - reescribir descripción", "IA - réécrire la description", "KI - Beschreibung umschreiben", "IA - reescrever descrição", "AI - 重写描述", "AI - 説明を書き換え", "AI - 설명 다시 작성", "AI - विवरण फिर लिखें", "الذكاء الاصطناعي - إعادة كتابة الوصف"],
  ["AI - Rewrite Notes", "IA - reescribir notas", "IA - réécrire les notes", "KI - Notizen umschreiben", "IA - reescrever notas", "AI - 重写备注", "AI - メモを書き換え", "AI - 메모 다시 작성", "AI - नोट्स फिर लिखें", "الذكاء الاصطناعي - إعادة كتابة الملاحظات"],
  ["AI didn't find any countable items in this region.", "La IA no encontró elementos contables en esta región.", "L’IA n’a trouvé aucun élément comptable dans cette zone.", "Die KI hat in diesem Bereich keine zählbaren Positionen gefunden.", "A IA não encontrou itens contáveis nesta região.", "AI 在此区域未找到可计数项目。", "AIはこの領域でカウント可能な項目を見つけませんでした。", "AI가 이 영역에서 셀 수 있는 항목을 찾지 못했습니다.", "AI को इस क्षेत्र में गिनने योग्य आइटम नहीं मिले।", "لم يجد الذكاء الاصطناعي عناصر قابلة للعد في هذه المنطقة."],
  ["AI returned an unrecognized response. Try a tighter region or check the API key.", "La IA devolvió una respuesta no reconocida. Prueba una región más ajustada o revisa la clave API.", "L’IA a renvoyé une réponse non reconnue. Essayez une zone plus serrée ou vérifiez la clé API.", "Die KI gab eine unbekannte Antwort zurück. Einen engeren Bereich versuchen oder API-Schlüssel prüfen.", "A IA retornou uma resposta não reconhecida. Tente uma região menor ou verifique a chave API.", "AI 返回了无法识别的响应。请尝试更紧的区域或检查 API 密钥。", "AIが認識できない応答を返しました。より狭い領域を試すかAPIキーを確認してください。", "AI가 인식할 수 없는 응답을 반환했습니다. 더 좁은 영역을 시도하거나 API 키를 확인하세요.", "AI ने अपरिचित प्रतिक्रिया दी। छोटा क्षेत्र आज़माएँ या API key जाँचें।", "أعاد الذكاء الاصطناعي استجابة غير معروفة. جرّب منطقة أضيق أو تحقق من مفتاح API."],
  ["Choose a configured worksheet category before applying this result.", "Elige una categoría de hoja configurada antes de aplicar este resultado.", "Choisissez une catégorie de feuille configurée avant d’appliquer ce résultat.", "Vor dem Anwenden dieses Ergebnisses eine konfigurierte Arbeitsblattkategorie wählen.", "Escolha uma categoria de planilha configurada antes de aplicar este resultado.", "应用此结果前请选择已配置的工作表类别。", "この結果を適用する前に設定済みワークシートカテゴリを選択してください。", "이 결과를 적용하기 전에 구성된 워크시트 범주를 선택하세요.", "यह परिणाम लागू करने से पहले कॉन्फ़िगर वर्कशीट श्रेणी चुनें।", "اختر فئة ورقة عمل مكوّنة قبل تطبيق هذه النتيجة."],
  ["Create a worksheet before sending model quantities.", "Crea una hoja antes de enviar cantidades del modelo.", "Créez une feuille avant d’envoyer les quantités du modèle.", "Vor dem Senden von Modellmengen ein Arbeitsblatt erstellen.", "Crie uma planilha antes de enviar quantidades do modelo.", "发送模型数量前请先创建工作表。", "モデル数量を送信する前にワークシートを作成してください。", "모델 수량을 보내기 전에 워크시트를 만드세요.", "मॉडल मात्राएँ भेजने से पहले वर्कशीट बनाएँ।", "أنشئ ورقة عمل قبل إرسال كميات النموذج."],
  ["Create a worksheet first", "Crea una hoja primero", "Créez d’abord une feuille", "Zuerst ein Arbeitsblatt erstellen", "Crie uma planilha primeiro", "请先创建工作表", "先にワークシートを作成", "먼저 워크시트를 만드세요", "पहले वर्कशीट बनाएँ", "أنشئ ورقة عمل أولًا"],
  ["Create failed.", "No se pudo crear.", "Échec de la création.", "Erstellen fehlgeschlagen.", "Falha ao criar.", "创建失败。", "作成に失敗しました。", "생성 실패.", "बनाना विफल।", "فشل الإنشاء."],
  ["Could not crop the selected region.", "No se pudo recortar la región seleccionada.", "Impossible de rogner la zone sélectionnée.", "Ausgewählter Bereich konnte nicht zugeschnitten werden.", "Não foi possível cortar a região selecionada.", "无法裁剪所选区域。", "選択領域を切り抜けませんでした。", "선택한 영역을 자를 수 없습니다.", "चयनित क्षेत्र crop नहीं हो सका।", "تعذر قص المنطقة المحددة."],
  ["Failed to save the cropped image for AI analysis.", "No se pudo guardar la imagen recortada para análisis de IA.", "Échec de l’enregistrement de l’image rognée pour l’analyse IA.", "Zugeschnittenes Bild konnte nicht für die KI-Analyse gespeichert werden.", "Falha ao salvar a imagem cortada para análise de IA.", "无法保存用于 AI 分析的裁剪图像。", "AI分析用の切り抜き画像を保存できませんでした。", "AI 분석용으로 자른 이미지를 저장하지 못했습니다.", "AI विश्लेषण के लिए cropped image सहेजना विफल।", "فشل حفظ الصورة المقصوصة لتحليل الذكاء الاصطناعي."],
  ["Delete this section?", "¿Eliminar esta sección?", "Supprimer cette section?", "Diesen Abschnitt löschen?", "Excluir esta seção?", "删除此章节？", "このセクションを削除しますか？", "이 섹션을 삭제할까요?", "यह अनुभाग हटाएँ?", "حذف هذا القسم؟"],
  ["Delete folder", "Eliminar carpeta", "Supprimer le dossier", "Ordner löschen", "Excluir pasta", "删除文件夹", "フォルダーを削除", "폴더 삭제", "फ़ोल्डर हटाएँ", "حذف المجلد"],
  ["Double Time", "Doble tiempo", "Temps double", "Doppelte Zeit", "Hora dobrada", "双倍工时", "倍時間", "더블 타임", "डबल टाइम", "وقت مضاعف"],
  ["Export Table as CSV", "Exportar tabla como CSV", "Exporter le tableau en CSV", "Tabelle als CSV exportieren", "Exportar tabela como CSV", "将表格导出为 CSV", "表をCSVでエクスポート", "표를 CSV로 내보내기", "तालिका CSV के रूप में निर्यात करें", "تصدير الجدول كـ CSV"],
  ["Expected length (what should this be?)", "Longitud esperada (¿cuál debería ser?)", "Longueur attendue (quelle devrait-elle être?)", "Erwartete Länge (was sollte sie sein?)", "Comprimento esperado (qual deveria ser?)", "预期长度（应为多少？）", "期待長さ（本来はいくつですか？）", "예상 길이(얼마여야 하나요?)", "अपेक्षित लंबाई (यह कितनी होनी चाहिए?)", "الطول المتوقع (كم يجب أن يكون؟)"],
  ["Enter known dimension", "Ingresa dimensión conocida", "Saisir la dimension connue", "Bekannte Abmessung eingeben", "Inserir dimensão conhecida", "输入已知尺寸", "既知寸法を入力", "알려진 치수 입력", "ज्ञात आयाम दर्ज करें", "أدخل البعد المعروف"],
  ["File name cannot be empty.", "El nombre de archivo no puede estar vacío.", "Le nom du fichier ne peut pas être vide.", "Dateiname darf nicht leer sein.", "O nome do arquivo não pode ficar vazio.", "文件名不能为空。", "ファイル名は空にできません。", "파일 이름은 비워둘 수 없습니다.", "फ़ाइल नाम खाली नहीं हो सकता।", "لا يمكن أن يكون اسم الملف فارغًا."],
  ["No content available for preview", "No hay contenido disponible para vista previa", "Aucun contenu disponible pour l’aperçu", "Kein Inhalt für Vorschau verfügbar", "Nenhum conteúdo disponível para prévia", "没有可预览内容", "プレビュー可能なコンテンツはありません", "미리볼 콘텐츠가 없습니다", "पूर्वावलोकन के लिए कोई सामग्री उपलब्ध नहीं", "لا يوجد محتوى متاح للمعاينة"],
  ["No extracted content available", "No hay contenido extraído disponible", "Aucun contenu extrait disponible", "Kein extrahierter Inhalt verfügbar", "Nenhum conteúdo extraído disponível", "没有可用的提取内容", "抽出済みコンテンツはありません", "추출된 콘텐츠가 없습니다", "कोई निकाली गई सामग्री उपलब्ध नहीं", "لا يوجد محتوى مستخرج متاح"],
  ["No files yet. Upload files or drag and drop.", "Aún no hay archivos. Sube archivos o arrastra y suelta.", "Aucun fichier pour l’instant. Téléversez ou glissez-déposez des fichiers.", "Noch keine Dateien. Dateien hochladen oder per Drag-and-drop ablegen.", "Ainda não há arquivos. Envie arquivos ou arraste e solte.", "还没有文件。请上传文件或拖放。", "ファイルはまだありません。アップロードまたはドラッグ＆ドロップしてください。", "아직 파일이 없습니다. 파일을 업로드하거나 끌어다 놓으세요.", "अभी कोई फ़ाइल नहीं। फ़ाइलें अपलोड करें या drag and drop करें।", "لا توجد ملفات بعد. ارفع الملفات أو اسحبها وأفلتها."],
  ["No line items found.", "No se encontraron partidas.", "Aucune ligne trouvée.", "Keine Positionen gefunden.", "Nenhum item encontrado.", "未找到明细项。", "明細行が見つかりません。", "라인 항목이 없습니다.", "कोई लाइन आइटम नहीं मिला।", "لم يتم العثور على بنود."],
  ["No matches yet.", "Aún no hay coincidencias.", "Aucune correspondance pour l’instant.", "Noch keine Treffer.", "Ainda não há correspondências.", "还没有匹配项。", "一致はまだありません。", "아직 일치 항목이 없습니다.", "अभी कोई मिलान नहीं।", "لا توجد مطابقات بعد."],
  ["No spreadsheet selected", "No hay hoja de cálculo seleccionada", "Aucune feuille de calcul sélectionnée", "Keine Tabellenkalkulation ausgewählt", "Nenhuma planilha selecionada", "未选择电子表格", "スプレッドシートが選択されていません", "선택된 스프레드시트 없음", "कोई स्प्रेडशीट चयनित नहीं", "لم يتم تحديد جدول بيانات"],
  ["Open Plugin Tools to run this action.", "Abre las herramientas de plugins para ejecutar esta acción.", "Ouvrez les outils de modules pour exécuter cette action.", "Plugin-Werkzeuge öffnen, um diese Aktion auszuführen.", "Abra as ferramentas de plugin para executar esta ação.", "打开插件工具以运行此操作。", "この操作を実行するにはプラグインツールを開いてください。", "이 작업을 실행하려면 플러그인 도구를 여세요.", "यह क्रिया चलाने के लिए plugin tools खोलें।", "افتح أدوات المكونات الإضافية لتشغيل هذا الإجراء."],
  ["Preview not available for this file type", "Vista previa no disponible para este tipo de archivo", "Aperçu non disponible pour ce type de fichier", "Vorschau für diesen Dateityp nicht verfügbar", "Prévia indisponível para este tipo de arquivo", "此文件类型不支持预览", "このファイル形式はプレビューできません", "이 파일 형식은 미리볼 수 없습니다", "इस फ़ाइल प्रकार के लिए पूर्वावलोकन उपलब्ध नहीं", "المعاينة غير متاحة لهذا النوع من الملفات"],
  ["Search files...", "Buscar archivos...", "Rechercher des fichiers...", "Dateien suchen...", "Buscar arquivos...", "搜索文件...", "ファイルを検索...", "파일 검색...", "फ़ाइलें खोजें...", "البحث في الملفات..."],
  ["That file cannot be moved to the selected folder.", "Ese archivo no se puede mover a la carpeta seleccionada.", "Ce fichier ne peut pas être déplacé dans le dossier sélectionné.", "Diese Datei kann nicht in den ausgewählten Ordner verschoben werden.", "Esse arquivo não pode ser movido para a pasta selecionada.", "该文件无法移动到所选文件夹。", "そのファイルは選択したフォルダーに移動できません。", "해당 파일은 선택한 폴더로 이동할 수 없습니다.", "वह फ़ाइल चयनित फ़ोल्डर में नहीं ले जाई जा सकती।", "لا يمكن نقل هذا الملف إلى المجلد المحدد."],
  ["Linear", "Lineal", "Linéaire", "Linear", "Linear", "线性", "線形", "선형", "रेखीय", "خطي"],
  ["Polyline", "Polilínea", "Polyligne", "Polylinie", "Polilinha", "多段线", "ポリライン", "폴리라인", "पॉलीलाइन", "خط متعدد"],
  ["Rectangle", "Rectángulo", "Rectangle", "Rechteck", "Retângulo", "矩形", "長方形", "사각형", "आयत", "مستطيل"],
  ["Triangle", "Triángulo", "Triangle", "Dreieck", "Triângulo", "三角形", "三角形", "삼각형", "त्रिभुज", "مثلث"],
  ["Ellipse", "Elipse", "Ellipse", "Ellipse", "Elipse", "椭圆", "楕円", "타원", "दीर्घवृत्त", "قطع ناقص"],
  ["Vertical", "Vertical", "Vertical", "Vertikal", "Vertical", "垂直", "垂直", "수직", "ऊर्ध्वाधर", "رأسي"],
  ["Wall", "Muro", "Mur", "Wand", "Parede", "墙", "壁", "벽", "दीवार", "جدار"],
  ["Drop", "Caída", "Chute", "Abfall", "Queda", "落差", "落差", "낙차", "ड्रॉप", "هبوط"],
  ["Smart", "Inteligente", "Intelligent", "Smart", "Inteligente", "智能", "スマート", "스마트", "स्मार्ट", "ذكي"],
  ["Auto", "Automático", "Auto", "Automatisch", "Automático", "自动", "自動", "자동", "स्वचालित", "تلقائي"],
  ["Count", "Conteo", "Comptage", "Anzahl", "Contagem", "计数", "カウント", "개수", "गिनती", "العد"],
  ["Ask", "Preguntar", "Demander", "Fragen", "Perguntar", "询问", "質問", "질문", "पूछें", "اسأل"],
  ["Surface", "Superficie", "Surface", "Oberfläche", "Superfície", "表面", "表面", "표면", "सतह", "سطح"],
  ["Area", "Área", "Aire", "Fläche", "Área", "面积", "面積", "면적", "क्षेत्रफल", "المساحة"],
  ["Volume", "Volumen", "Volume", "Volumen", "Volume", "体积", "体積", "부피", "आयतन", "الحجم"],
  ["Elements", "Elementos", "Éléments", "Elemente", "Elementos", "元素", "要素", "요소", "तत्व", "العناصر"],
  ["Object", "Objeto", "Objet", "Objekt", "Objeto", "对象", "オブジェクト", "객체", "ऑब्जेक्ट", "الكائن"],
  ["Objects", "Objetos", "Objets", "Objekte", "Objetos", "对象", "オブジェクト", "객체", "ऑब्जेक्ट", "الكائنات"],
  ["Rows", "Filas", "Lignes", "Zeilen", "Linhas", "行", "行", "행", "पंक्तियाँ", "الصفوف"],
  ["Row", "Fila", "Ligne", "Zeile", "Linha", "行", "行", "행", "पंक्ति", "الصف"],
  ["Columns", "Columnas", "Colonnes", "Spalten", "Colunas", "列", "列", "열", "स्तंभ", "الأعمدة"],
  ["Column", "Columna", "Colonne", "Spalte", "Coluna", "列", "列", "열", "स्तंभ", "العمود"],
  ["Drawing", "Plano", "Dessin", "Zeichnung", "Desenho", "图纸", "図面", "도면", "ड्रॉइंग", "الرسم"],
  ["Drawings", "Planos", "Dessins", "Zeichnungen", "Desenhos", "图纸", "図面", "도면", "ड्रॉइंग", "الرسومات"],
  ["Model", "Modelo", "Modèle", "Modell", "Modelo", "模型", "モデル", "모델", "मॉडल", "النموذج"],
  ["Tool", "Herramienta", "Outil", "Werkzeug", "Ferramenta", "工具", "ツール", "도구", "उपकरण", "الأداة"],
  ["Tools", "Herramientas", "Outils", "Werkzeuge", "Ferramentas", "工具", "ツール", "도구", "उपकरण", "الأدوات"],
  ["Trade", "Oficio", "Métier", "Gewerk", "Disciplina", "专业", "工種", "공종", "ट्रेड", "التخصص"],
  ["Spreadsheet", "Hoja de cálculo", "Feuille de calcul", "Tabellenkalkulation", "Planilha", "电子表格", "スプレッドシート", "스프레드시트", "स्प्रेडशीट", "جدول بيانات"],
  ["Target", "Destino", "Cible", "Ziel", "Destino", "目标", "対象", "대상", "लक्ष्य", "الهدف"],
  ["Numeric", "Numéricos", "Numériques", "Numerisch", "Numéricos", "数值", "数値", "숫자", "संख्यात्मक", "رقمية"],
  ["Mapped", "Mapeados", "Mappés", "Zugeordnet", "Mapeados", "已映射", "マッピング済み", "매핑됨", "मैप किए गए", "معينة"],
  ["Fields", "Campos", "Champs", "Felder", "Campos", "字段", "フィールド", "필드", "फ़ील्ड", "الحقول"],
  ["Field", "Campo", "Champ", "Feld", "Campo", "字段", "フィールド", "필드", "फ़ील्ड", "الحقل"],
  ["Upload", "Subir", "Téléverser", "Hochladen", "Enviar", "上传", "アップロード", "업로드", "अपलोड करें", "رفع"],
  ["Files", "Archivos", "Fichiers", "Dateien", "Arquivos", "文件", "ファイル", "파일", "फ़ाइलें", "الملفات"],
  ["File", "Archivo", "Fichier", "Datei", "Arquivo", "文件", "ファイル", "파일", "फ़ाइल", "الملف"],
  ["Books", "Libros", "Livres", "Bücher", "Livros", "书籍", "ブック", "책", "पुस्तकें", "الدفاتر"],
  ["Knowledge", "Conocimiento", "Connaissances", "Wissen", "Conhecimento", "知识", "ナレッジ", "지식", "ज्ञान", "المعرفة"],
  ["Scale", "Escala", "Échelle", "Maßstab", "Escala", "比例", "スケール", "축척", "स्केल", "المقياس"],
  ["Legend", "Leyenda", "Légende", "Legende", "Legenda", "图例", "凡例", "범례", "लेजेंड", "وسيلة الإيضاح"],
  ["Symbol", "Símbolo", "Symbole", "Symbol", "Símbolo", "符号", "記号", "기호", "प्रतीक", "الرمز"],
  ["Undo", "Deshacer", "Annuler", "Rückgängig", "Desfazer", "撤销", "元に戻す", "실행 취소", "पूर्ववत करें", "تراجع"],
  ["Redo", "Rehacer", "Rétablir", "Wiederholen", "Refazer", "重做", "やり直す", "다시 실행", "फिर करें", "إعادة"],
  ["Export", "Exportar", "Exporter", "Exportieren", "Exportar", "导出", "エクスポート", "내보내기", "निर्यात करें", "تصدير"],
  ["Selected", "Seleccionado", "Sélectionné", "Ausgewählt", "Selecionado", "已选", "選択済み", "선택됨", "चयनित", "المحدد"],
  ["View", "Vista", "Vue", "Ansicht", "Visualização", "视图", "ビュー", "보기", "दृश्य", "العرض"],
  ["Current Source", "Origen actual", "Source actuelle", "Aktuelle Quelle", "Origem atual", "当前来源", "現在のソース", "현재 소스", "वर्तमान स्रोत", "المصدر الحالي"],
  ["Sensitivity", "Sensibilidad", "Sensibilité", "Empfindlichkeit", "Sensibilidade", "灵敏度", "感度", "민감도", "संवेदनशीलता", "الحساسية"],
  ["Scanning", "Escaneando", "Analyse", "Scan läuft", "Escaneando", "正在扫描", "スキャン中", "스캔 중", "स्कैन हो रहा है", "جارٍ المسح"],
  ["Index", "Índice", "Index", "Index", "Índice", "索引", "インデックス", "색인", "इंडेक्स", "الفهرس"],
  ["Sync", "Sincronizar", "Synchroniser", "Synchronisieren", "Sincronizar", "同步", "同期", "동기화", "सिंक", "مزامنة"],
  ["Expected", "Esperado", "Attendu", "Erwartet", "Esperado", "预期", "想定", "예상", "अपेक्षित", "المتوقع"],
  ["Known", "Conocido", "Connu", "Bekannt", "Conhecido", "已知", "既知", "알려진", "ज्ञात", "المعروف"],
  ["Dimension", "Dimensión", "Dimension", "Abmessung", "Dimensão", "尺寸", "寸法", "치수", "आयाम", "البعد"],
  ["Distance", "Distancia", "Distance", "Abstand", "Distância", "距离", "距離", "거리", "दूरी", "المسافة"],
  ["Detected", "Detectado", "Détecté", "Erkannt", "Detectado", "已检测", "検出済み", "감지됨", "पहचाना गया", "مكتشف"],
  ["Title Block", "Cajetín", "Cartouche", "Schriftfeld", "Carimbo", "标题栏", "タイトルブロック", "제목란", "टाइटल ब्लॉक", "كتلة العنوان"],
  ["Notation", "Notación", "Notation", "Notation", "Notação", "标注", "表記", "표기", "नोटेशन", "الترميز"],
  ["Manual", "Manual", "Manuel", "Manuell", "Manual", "手动", "手動", "수동", "मैनुअल", "يدوي"],
  ["Presets", "Preajustes", "Préréglages", "Voreinstellungen", "Predefinições", "预设", "プリセット", "프리셋", "प्रीसेट", "الإعدادات المسبقة"],
  ["Matched", "Coincidente", "Correspondant", "Abgeglichen", "Correspondente", "已匹配", "一致", "일치", "मेल खाया", "مطابق"],
  ["Resulting", "Resultante", "Résultant", "Ergebnis", "Resultante", "结果", "結果", "결과", "परिणामी", "الناتج"],
  ["Reject", "Rechazar", "Rejeter", "Ablehnen", "Rejeitar", "拒绝", "却下", "거부", "अस्वीकार करें", "رفض"],
  ["Accept", "Aceptar", "Accepter", "Akzeptieren", "Aceitar", "接受", "承認", "수락", "स्वीकार करें", "قبول"],
  ["Tip", "Consejo", "Astuce", "Tipp", "Dica", "提示", "ヒント", "팁", "सुझाव", "نصيحة"],
  ["Chat", "Chat", "Clavardage", "Chat", "Chat", "聊天", "チャット", "채팅", "चैट", "الدردشة"],
  ["Analysis", "Análisis", "Analyse", "Analyse", "Análise", "分析", "分析", "분석", "विश्लेषण", "التحليل"],
  ["Preparing", "Preparando", "Préparation", "Vorbereitung", "Preparando", "准备中", "準備中", "준비 중", "तैयार हो रहा है", "جارٍ التحضير"],
  ["Loading", "Cargando", "Chargement", "Laden", "Carregando", "加载中", "読み込み中", "로드 중", "लोड हो रहा है", "جارٍ التحميل"],
  ["Preview", "Vista previa", "Aperçu", "Vorschau", "Prévia", "预览", "プレビュー", "미리보기", "पूर्वावलोकन", "معاينة"],
  ["Download", "Descargar", "Télécharger", "Herunterladen", "Baixar", "下载", "ダウンロード", "다운로드", "डाउनलोड", "تنزيل"],
  ["Fullscreen", "Pantalla completa", "Plein écran", "Vollbild", "Tela cheia", "全屏", "全画面", "전체 화면", "पूर्ण स्क्रीन", "ملء الشاشة"],
  ["Zoom", "Zoom", "Zoom", "Zoom", "Zoom", "缩放", "ズーム", "확대/축소", "ज़ूम", "تكبير"],
  ["Width", "Ancho", "Largeur", "Breite", "Largura", "宽度", "幅", "너비", "चौड़ाई", "العرض"],
  ["Content", "Contenido", "Contenu", "Inhalt", "Conteúdo", "内容", "コンテンツ", "콘텐츠", "सामग्री", "المحتوى"],
  ["Text", "Texto", "Texte", "Text", "Texto", "文本", "テキスト", "텍스트", "पाठ", "النص"],
  ["Image", "Imagen", "Image", "Bild", "Imagem", "图像", "画像", "이미지", "छवि", "الصورة"],
  ["Caption", "Leyenda", "Légende", "Bildunterschrift", "Legenda", "标题", "キャプション", "캡션", "कैप्शन", "التسمية"],
  ["Report", "Informe", "Rapport", "Bericht", "Relatório", "报告", "レポート", "보고서", "रिपोर्ट", "التقرير"],
  ["Lead", "Carta inicial", "Lettre", "Anschreiben", "Carta", "引导", "リード", "리드", "लीड", "التمهيد"],
  ["Letter", "Carta", "Lettre", "Brief", "Carta", "信函", "レター", "서신", "पत्र", "الخطاب"],
  ["Building", "Creando", "Création", "Erstellung", "Criando", "构建", "作成中", "작성", "बनाना", "البناء"],
  ["Replace", "Reemplazar", "Remplacer", "Ersetzen", "Substituir", "替换", "置換", "교체", "बदलें", "استبدال"],
  ["Estimator", "Estimador", "Estimateur", "Kalkulator", "Estimador", "估算员", "見積担当", "견적 담당자", "अनुमानकर्ता", "المقدّر"],
  ["Scratchpad", "Bloc de notas", "Bloc-notes", "Notizbereich", "Rascunho", "草稿板", "スクラッチパッド", "메모장", "स्क्रैचपैड", "المسودة"],
  ["Single", "Único", "Unique", "Einzeln", "Único", "单个", "単一", "단일", "एकल", "واحد"],
  ["Sell", "Venta", "Vente", "Verkauf", "Venda", "销售", "売価", "판매", "विक्रय", "البيع"],
  ["Vendor", "Proveedor", "Fournisseur", "Anbieter", "Fornecedor", "供应商", "ベンダー", "공급업체", "विक्रेता", "المورّد"],
  ["Vendors", "Proveedores", "Fournisseurs", "Anbieter", "Fornecedores", "供应商", "ベンダー", "공급업체", "विक्रेता", "المورّدون"],
  ["MasterFormat", "MasterFormat", "MasterFormat", "MasterFormat", "MasterFormat", "MasterFormat", "MasterFormat", "MasterFormat", "MasterFormat", "ماستر فورمات"],
  ["UniFormat", "UniFormat", "UniFormat", "UniFormat", "UniFormat", "UniFormat", "UniFormat", "UniFormat", "UniFormat", "يونيفورمات"],
  ["Uniclass", "Uniclass", "Uniclass", "Uniclass", "Uniclass", "Uniclass", "Uniclass", "Uniclass", "Uniclass", "يونيكلاس"],
  ["Rules", "Reglas", "Règles", "Regeln", "Regras", "规则", "ルール", "규칙", "नियम", "القواعد"],
  ["Measurement", "Medición", "Mesure", "Messung", "Medição", "测量", "測定", "측정", "माप", "القياس"],
  ["Company", "Empresa", "Entreprise", "Unternehmen", "Empresa", "公司", "会社", "회사", "कंपनी", "الشركة"],
  ["Codes", "Códigos", "Codes", "Codes", "Códigos", "代码", "コード", "코드", "कोड", "الأكواد"],
  ["Full", "Completo", "Complet", "Vollständig", "Completo", "完整", "完全", "전체", "पूर्ण", "كامل"],
  ["Fixed", "Fijo", "Fixe", "Fest", "Fixo", "固定", "固定", "고정", "निश्चित", "ثابت"],
  ["Optional", "Opcional", "Optionnel", "Optional", "Opcional", "可选", "任意", "선택", "वैकल्पिक", "اختياري"],
  ["Standalone", "Independiente", "Autonome", "Eigenständig", "Independente", "独立", "単独", "독립", "स्वतंत्र", "مستقل"],
  ["Avg", "Prom.", "Moy.", "Durchschn.", "Méd.", "平均", "平均", "평균", "औसत", "متوسط"],
  ["Rate", "Tarifa", "Taux", "Satz", "Taxa", "费率", "レート", "요율", "दर", "السعر"],
  ["Entire", "Completa", "Entier", "Gesamt", "Inteira", "整个", "全体", "전체", "संपूर्ण", "كامل"],
  ["Rollups", "Acumulados", "Regroupements", "Rollups", "Consolidações", "汇总", "ロールアップ", "롤업", "रोलअप", "التجميعات"],
  ["Raw", "Bruto", "Brut", "Roh", "Bruto", "原始", "未加工", "원시", "कच्चा", "خام"],
  ["Customer", "Cliente", "Client", "Kunde", "Cliente", "客户", "顧客", "고객", "ग्राहक", "العميل"],
  ["Adjustments", "Ajustes", "Ajustements", "Anpassungen", "Ajustes", "调整", "調整", "조정", "समायोजन", "التعديلات"],
  ["Risk", "Riesgo", "Risque", "Risiko", "Risco", "风险", "リスク", "위험", "जोखिम", "المخاطر"],
  ["Range", "Rango", "Plage", "Bereich", "Intervalo", "范围", "範囲", "범위", "सीमा", "النطاق"],
  ["Concentration", "Concentración", "Concentration", "Konzentration", "Concentração", "集中度", "集中", "집중도", "सघनता", "التركيز"],
  ["Driver", "Impulsor", "Facteur", "Treiber", "Impulsionador", "驱动项", "ドライバー", "동인", "चालक", "المحرّك"],
  ["Largest", "Mayor", "Plus grand", "Größte", "Maior", "最大", "最大", "최대", "सबसे बड़ा", "الأكبر"],
  ["Blended", "Combinado", "Combiné", "Gemischt", "Combinado", "混合", "混合", "혼합", "मिश्रित", "مختلط"],
  ["Gross", "Bruto", "Brut", "Brutto", "Bruto", "毛", "粗", "총", "सकल", "الإجمالي"],
  ["Resources", "Recursos", "Ressources", "Ressourcen", "Recursos", "资源", "リソース", "리소스", "संसाधन", "الموارد"],
  ["Composition", "Composición", "Composition", "Zusammensetzung", "Composição", "组成", "構成", "구성", "संरचना", "التركيب"],
  ["Captured", "Capturado", "Capturé", "Erfasst", "Capturado", "已捕获", "取得済み", "캡처됨", "कैप्चर किया गया", "ملتقط"],
  ["Filters", "Filtros", "Filtres", "Filter", "Filtros", "筛选器", "フィルター", "필터", "फ़िल्टर", "المرشحات"],
  ["Pivot", "Tabla dinámica", "Tableau croisé", "Pivot", "Tabela dinâmica", "透视", "ピボット", "피벗", "पिवट", "جدول محوري"],
  ["Proposal", "Propuesta", "Proposition", "Angebot", "Proposta", "提案", "提案", "제안", "प्रस्ताव", "المقترح"],
  ["Fixed add", "Adición fija", "Ajout fixe", "Fester Zuschlag", "Adição fixa", "固定增加", "固定追加", "고정 추가", "निश्चित जोड़", "إضافة ثابتة"],
  ["Labour", "Mano de obra", "Main-d’œuvre", "Arbeit", "Mão de obra", "人工", "労務", "노무", "श्रम", "العمالة"],
  ["Sub-class", "Subclase", "Sous-classe", "Unterklasse", "Subclasse", "子类", "サブクラス", "하위 클래스", "उप-वर्ग", "فئة فرعية"],
  ["Provider", "Proveedor", "Fournisseur", "Anbieter", "Fornecedor", "提供商", "プロバイダー", "공급자", "प्रदाता", "المزوّد"],
  ["Metadata", "Metadatos", "Métadonnées", "Metadaten", "Metadados", "元数据", "メタデータ", "메타데이터", "मेटाडेटा", "البيانات الوصفية"],
  ["External", "Externo", "Externe", "Extern", "Externo", "外部", "外部", "외부", "बाहरी", "خارجي"],
  ["Libraries", "Bibliotecas", "Bibliothèques", "Bibliotheken", "Bibliotecas", "库", "ライブラリ", "라이브러리", "लाइब्रेरी", "المكتبات"],
  ["Tabs", "Pestañas", "Onglets", "Tabs", "Abas", "标签页", "タブ", "탭", "टैब", "علامات التبويب"],
  ["Folders", "Carpetas", "Dossiers", "Ordner", "Pastas", "文件夹", "フォルダー", "폴더", "फ़ोल्डर", "المجلدات"],
  ["Toggle", "Alternar", "Basculer", "Umschalten", "Alternar", "切换", "切替", "전환", "टॉगल", "تبديل"],
  ["Duplicate", "Duplicar", "Dupliquer", "Duplizieren", "Duplicar", "复制", "複製", "복제", "डुप्लिकेट", "تكرار"],
  ["Assembly", "Ensamblaje", "Assemblage", "Baugruppe", "Montagem", "组件", "アセンブリ", "어셈블리", "असेंबली", "التجميعة"],
  ["Root", "Raíz", "Racine", "Stamm", "Raiz", "根", "ルート", "루트", "रूट", "الجذر"],
  ["Detail", "Detalle", "Détail", "Detail", "Detalhe", "详细", "詳細", "세부 정보", "विवरण", "التفصيل"],
  ["Rich", "Enriquecido", "Riche", "Rich", "Rico", "富文本", "リッチ", "리치", "रिच", "غني"],
  ["Whiteboard", "Pizarra", "Tableau blanc", "Whiteboard", "Quadro branco", "白板", "ホワイトボード", "화이트보드", "व्हाइटबोर्ड", "لوح أبيض"],
  ["Diagram", "Diagrama", "Diagramme", "Diagramm", "Diagrama", "图表", "図", "다이어그램", "आरेख", "مخطط"],
  ["Markdown", "Markdown", "Markdown", "Markdown", "Markdown", "Markdown", "Markdown", "Markdown", "Markdown", "ماركداون"],
  ["Checklist", "Lista de verificación", "Liste de contrôle", "Checkliste", "Checklist", "检查清单", "チェックリスト", "체크리스트", "चेकलिस्ट", "قائمة تحقق"],
  ["Punch", "Remates", "Réserves", "Mängel", "Pendências", "待办", "パンチ", "펀치", "पंच", "النواقص"],
  ["List", "Lista", "Liste", "Liste", "Lista", "列表", "リスト", "목록", "सूची", "القائمة"],
  ["Separate", "Separado", "Séparé", "Getrennt", "Separado", "分开", "個別", "분리", "अलग", "منفصل"],
  ["Combined", "Combinado", "Combiné", "Kombiniert", "Combinado", "合并", "結合", "결합", "संयुक्त", "مجمّع"],
  ["Tables", "Tablas", "Tableaux", "Tabellen", "Tabelas", "表格", "表", "표", "तालिकाएँ", "الجداول"],
  ["Accent", "Acento", "Accent", "Akzent", "Destaque", "强调", "アクセント", "강조", "एक्सेंट", "تمييز"],
  ["Wash", "Lavado", "Lavis", "Waschung", "Lavagem", "淡色", "ウォッシュ", "워시", "वॉश", "غسل"],
  ["Texture", "Textura", "Texture", "Textur", "Textura", "纹理", "テクスチャ", "텍스처", "टेक्सचर", "الملمس"],
  ["Footer", "Pie de página", "Pied de page", "Fußzeile", "Rodapé", "页脚", "フッター", "바닥글", "फुटर", "التذييل"],
  ["Section", "Sección", "Section", "Abschnitt", "Seção", "章节", "セクション", "섹션", "अनुभाग", "القسم"],
  ["Sub-section", "Subsección", "Sous-section", "Unterabschnitt", "Subseção", "子章节", "サブセクション", "하위 섹션", "उप-अनुभाग", "قسم فرعي"],
  ["Table", "Tabla", "Tableau", "Tabelle", "Tabela", "表格", "表", "표", "तालिका", "الجدول"],
  ["Label", "Etiqueta", "Libellé", "Beschriftung", "Rótulo", "标签", "ラベル", "레이블", "लेबल", "التسمية"],
  ["Group", "Grupo", "Groupe", "Gruppe", "Grupo", "组", "グループ", "그룹", "समूह", "المجموعة"],
  ["Click", "Haz clic", "Cliquer", "Klicken", "Clique", "点击", "クリック", "클릭", "क्लिक करें", "انقر"],
  ["Selection", "Selección", "Sélection", "Auswahl", "Seleção", "选择", "選択", "선택", "चयन", "التحديد"],
  ["Assign", "Asignar", "Assigner", "Zuweisen", "Atribuir", "分配", "割り当て", "할당", "असाइन करें", "تعيين"],
  ["Applied", "Aplicado", "Appliqué", "Angewendet", "Aplicado", "已应用", "適用済み", "적용됨", "लागू", "مطبق"],
  ["Applies", "Aplica", "S’applique", "Gilt", "Aplica", "适用于", "適用", "적용", "लागू होता है", "ينطبق"],
  ["Back", "Volver", "Retour", "Zurück", "Voltar", "返回", "戻る", "뒤로", "वापस", "رجوع"],
  ["Condition", "Condición", "Condition", "Bedingung", "Condição", "条件", "条件", "조건", "स्थिति", "الشرط"],
  ["Difficulty", "Dificultad", "Difficulté", "Schwierigkeit", "Dificuldade", "难度", "難易度", "난이도", "कठिनाई", "الصعوبة"],
  ["Score", "Puntaje", "Score", "Wert", "Pontuação", "评分", "スコア", "점수", "स्कोर", "الدرجة"],
  ["Calibrated", "Calibrado", "Calibré", "Kalibriert", "Calibrado", "已校准", "校正済み", "보정됨", "कैलिब्रेटेड", "معاير"],
  ["Multiplier", "Multiplicador", "Multiplicateur", "Multiplikator", "Multiplicador", "倍数", "倍率", "승수", "गुणक", "المضاعف"],
  ["Duration", "Duración", "Durée", "Dauer", "Duração", "持续时间", "期間", "기간", "अवधि", "المدة"],
  ["Extended", "Extendido", "Étendu", "Erweitert", "Estendido", "扩展", "延長", "확장", "विस्तारित", "ممتد"],
  ["Bucket", "Grupo", "Lot", "Bucket", "Agrupamento", "分组", "バケット", "버킷", "बकेट", "حاوية"],
  ["Hierarchy", "Jerarquía", "Hiérarchie", "Hierarchie", "Hierarquia", "层级", "階層", "계층", "पदानुक्रम", "التسلسل"],
  ["Length", "Longitud", "Longueur", "Länge", "Comprimento", "长度", "長さ", "길이", "लंबाई", "الطول"],
  ["Spacing", "Espaciado", "Espacement", "Abstand", "Espaçamento", "间距", "間隔", "간격", "अंतर", "التباعد"],
  ["Error", "Error", "Erreur", "Fehler", "Erro", "错误", "エラー", "오류", "त्रुटि", "خطأ"],
  ["Failed", "Falló", "Échec", "Fehlgeschlagen", "Falhou", "失败", "失敗", "실패", "विफल", "فشل"],
  ["Extracted", "Extraído", "Extrait", "Extrahiert", "Extraído", "已提取", "抽出済み", "추출됨", "निकाला गया", "مستخرج"],
  ["Configured", "Configurado", "Configuré", "Konfiguriert", "Configurado", "已配置", "設定済み", "구성됨", "कॉन्फ़िगर", "مكوّن"],
  ["Low", "Bajo", "Faible", "Niedrig", "Baixo", "低", "低", "낮음", "कम", "منخفض"],
  ["Match", "Coincidencia", "Correspondance", "Treffer", "Correspondência", "匹配", "一致", "일치", "मिलान", "مطابقة"],
  ["Matches", "Coincidencias", "Correspondances", "Treffer", "Correspondências", "匹配", "一致", "일치", "मिलान", "المطابقات"],
  ["Ready", "Listo", "Prêt", "Bereit", "Pronto", "就绪", "準備完了", "준비됨", "तैयार", "جاهز"],
  ["Mechanical", "Mecánico", "Mécanique", "Mechanisch", "Mecânico", "机械", "機械", "기계", "मैकेनिकल", "ميكانيكي"],
  ["Foundation", "Cimentación", "Fondation", "Fundament", "Fundação", "基础", "基礎", "기초", "नींव", "الأساس"],
  ["Walls", "Muros", "Murs", "Wände", "Paredes", "墙", "壁", "벽", "दीवारें", "الجدران"],
  ["Electrical", "Eléctrico", "Électrique", "Elektrisch", "Elétrico", "电气", "電気", "전기", "विद्युत", "كهربائي"],
  ["Measure distance between two points", "Medir distancia entre dos puntos", "Mesurer la distance entre deux points", "Abstand zwischen zwei Punkten messen", "Medir distância entre dois pontos", "测量两点之间的距离", "2点間の距離を測定", "두 점 사이 거리 측정", "दो बिंदुओं के बीच दूरी मापें", "قياس المسافة بين نقطتين"],
  ["Measure length along multiple points", "Medir longitud a lo largo de varios puntos", "Mesurer la longueur sur plusieurs points", "Länge über mehrere Punkte messen", "Medir comprimento por vários pontos", "沿多个点测量长度", "複数点に沿って長さを測定", "여러 점을 따라 길이 측정", "कई बिंदुओं पर लंबाई मापें", "قياس الطول عبر نقاط متعددة"],
  ["Polyline with drop distance at each vertex", "Polilínea con caída en cada vértice", "Polyligne avec chute à chaque sommet", "Polylinie mit Abfall an jedem Scheitel", "Polilinha com queda em cada vértice", "每个顶点带落差的多段线", "各頂点に落差があるポリライン", "각 꼭짓점에 낙차가 있는 폴리라인", "हर शीर्ष पर ड्रॉप दूरी वाली पॉलीलाइन", "خط متعدد مع هبوط عند كل رأس"],
  ["Click to count individual items", "Haz clic para contar elementos individuales", "Cliquez pour compter les éléments individuels", "Klicken, um einzelne Positionen zu zählen", "Clique para contar itens individuais", "点击计数单个项目", "クリックして個別項目をカウント", "개별 항목을 세려면 클릭", "व्यक्तिगत आइटम गिनने के लिए क्लिक करें", "انقر لعد العناصر الفردية"],
  ["Auto-count items along a line at interval", "Contar automáticamente elementos a intervalos en una línea", "Compter automatiquement les éléments à intervalle le long d’une ligne", "Positionen in Intervallen entlang einer Linie automatisch zählen", "Contar automaticamente itens em intervalos ao longo de uma linha", "沿线按间距自动计数项目", "線に沿って間隔ごとに自動カウント", "선 위 간격별 항목 자동 계산", "रेखा पर अंतराल के अनुसार आइटम स्वतः गिनें", "عد العناصر تلقائيًا على خط بفواصل"],
  ["Rectangular area measurement", "Medición de área rectangular", "Mesure d’aire rectangulaire", "Rechteckige Flächenmessung", "Medição de área retangular", "矩形面积测量", "長方形面積の測定", "사각형 면적 측정", "आयताकार क्षेत्र मापन", "قياس مساحة مستطيلة"],
  ["Freeform polygon area measurement", "Medición de área poligonal libre", "Mesure d’aire de polygone libre", "Freie Polygonflächenmessung", "Medição de área de polígono livre", "自由多边形面积测量", "自由ポリゴン面積の測定", "자유형 다각형 면적 측정", "मुक्त बहुभुज क्षेत्र मापन", "قياس مساحة مضلع حر"],
  ["Triangular area measurement", "Medición de área triangular", "Mesure d’aire triangulaire", "Dreieckige Flächenmessung", "Medição de área triangular", "三角形面积测量", "三角形面積の測定", "삼각형 면적 측정", "त्रिभुज क्षेत्र मापन", "قياس مساحة مثلثة"],
  ["Elliptical area measurement", "Medición de área elíptica", "Mesure d’aire elliptique", "Elliptische Flächenmessung", "Medição de área elíptica", "椭圆面积测量", "楕円面積の測定", "타원 면적 측정", "दीर्घवृत्त क्षेत्र मापन", "قياس مساحة بيضاوية"],
  ["Wall area from perimeter and height", "Área de muro desde perímetro y altura", "Aire de mur à partir du périmètre et de la hauteur", "Wandfläche aus Umfang und Höhe", "Área de parede por perímetro e altura", "按周长和高度计算墙面积", "周長と高さから壁面積を計算", "둘레와 높이로 벽 면적 계산", "परिमाप और ऊँचाई से दीवार क्षेत्र", "مساحة الجدار من المحيط والارتفاع"],
  ["Set scale by measuring a known distance", "Definir escala midiendo una distancia conocida", "Définir l’échelle en mesurant une distance connue", "Maßstab durch Messen einer bekannten Strecke setzen", "Definir escala medindo uma distância conhecida", "通过测量已知距离设置比例", "既知距離を測ってスケールを設定", "알려진 거리를 측정해 축척 설정", "ज्ञात दूरी मापकर स्केल सेट करें", "تعيين المقياس بقياس مسافة معروفة"],
  ["Extract estimate-ready line items, quantities, vendor BOM rows, equipment schedules, alternates, and allowances.", "Extrae partidas listas para estimar, cantidades, filas BOM de proveedor, programas de equipo, alternativos y asignaciones.", "Extraire les lignes prêtes pour l’estimation, quantités, lignes de nomenclature fournisseur, calendriers d’équipement, variantes et provisions.", "Kalkulationsfertige Positionen, Mengen, Lieferanten-BOM-Zeilen, Gerätepläne, Alternativen und Zulagen extrahieren.", "Extraia itens prontos para estimativa, quantidades, linhas BOM de fornecedor, cronogramas de equipamento, alternativas e verbas.", "提取可用于估算的明细项、数量、供应商 BOM 行、设备计划、备选项和暂列金额。", "見積用の明細、数量、ベンダーBOM行、機器スケジュール、代替案、許容額を抽出します。", "견적 준비 라인 항목, 수량, 공급업체 BOM 행, 장비 일정, 대안 및 허용액을 추출합니다.", "अनुमान-ready लाइन आइटम, मात्रा, विक्रेता BOM पंक्तियाँ, उपकरण शेड्यूल, विकल्प और भत्ते निकालें।", "استخرج البنود الجاهزة للتقدير والكميات وصفوف BOM للمورّد وجداول المعدات والبدائل والمخصصات."],
  ["Stage the results by worksheet with source references before applying anything.", "Organiza los resultados por hoja con referencias de origen antes de aplicar nada.", "Préparez les résultats par feuille avec les références source avant toute application.", "Ergebnisse vor dem Anwenden nach Arbeitsblatt mit Quellenangaben bereitstellen.", "Prepare os resultados por planilha com referências de origem antes de aplicar qualquer coisa.", "应用前按工作表暂存结果并附来源引用。", "適用前にソース参照付きでワークシート別に結果を準備します。", "적용하기 전에 원본 참조와 함께 워크시트별로 결과를 준비합니다.", "कुछ भी लागू करने से पहले स्रोत संदर्भों के साथ परिणामों को वर्कशीट अनुसार रखें।", "نظّم النتائج حسب ورقة العمل مع مراجع المصدر قبل تطبيق أي شيء."],
  ["Use tables, schedules, quotes, and written scope.", "Usa tablas, programas, cotizaciones y alcance escrito.", "Utiliser tableaux, calendriers, devis et portée écrite.", "Tabellen, Pläne, Angebote und schriftlichen Umfang verwenden.", "Use tabelas, cronogramas, cotações e escopo escrito.", "使用表格、计划、报价和书面范围。", "表、スケジュール、見積、記載された範囲を使用します。", "표, 일정, 견적, 작성된 범위를 사용합니다.", "तालिकाएँ, शेड्यूल, कोटेशन और लिखित दायरे का उपयोग करें।", "استخدم الجداول والجداول الزمنية والعروض والنطاق المكتوب."],
  ["Open the configured tool catalog for this workspace.", "Abre el catálogo de herramientas configurado para este espacio de trabajo.", "Ouvrir le catalogue d’outils configuré pour cet espace de travail.", "Den konfigurierten Werkzeugkatalog für diesen Arbeitsbereich öffnen.", "Abra o catálogo de ferramentas configurado para este workspace.", "打开此工作区配置的工具目录。", "このワークスペース用に設定されたツールカタログを開きます。", "이 워크스페이스에 구성된 도구 카탈로그를 엽니다.", "इस कार्यक्षेत्र के लिए कॉन्फ़िगर टूल कैटलॉग खोलें।", "افتح كتالوج الأدوات المكوّن لمساحة العمل هذه."],
  ["Drawing scale isn't set — measurements will be in pixels until you calibrate.", "La escala del plano no está definida; las mediciones estarán en píxeles hasta calibrar.", "L’échelle du dessin n’est pas définie; les mesures seront en pixels jusqu’au calibrage.", "Der Zeichnungsmaßstab ist nicht gesetzt; Messungen bleiben bis zur Kalibrierung in Pixeln.", "A escala do desenho não está definida; as medições ficarão em pixels até calibrar.", "尚未设置图纸比例，校准前测量将以像素显示。", "図面スケールが未設定です。校正するまで測定値はピクセルになります。", "도면 축척이 설정되지 않았습니다. 보정 전까지 측정값은 픽셀입니다.", "ड्रॉइंग स्केल सेट नहीं है; कैलिब्रेट होने तक माप पिक्सेल में रहेंगे।", "لم يتم تعيين مقياس الرسم؛ ستبقى القياسات بالبكسل حتى المعايرة."],
  ["Click below to set the scale, or pick the Calibrate tool from the side palette.", "Haz clic abajo para definir la escala o elige Calibrar en la paleta lateral.", "Cliquez ci-dessous pour définir l’échelle ou choisissez l’outil Calibrer dans la palette latérale.", "Unten klicken, um den Maßstab zu setzen, oder das Kalibrieren-Werkzeug aus der Seitenpalette wählen.", "Clique abaixo para definir a escala ou escolha a ferramenta Calibrar na paleta lateral.", "点击下方设置比例，或从侧边工具栏选择校准工具。", "下をクリックしてスケールを設定するか、サイドパレットから校正ツールを選択します。", "아래를 클릭해 축척을 설정하거나 사이드 팔레트에서 보정 도구를 선택하세요.", "स्केल सेट करने के लिए नीचे क्लिक करें, या साइड पैलेट से Calibrate टूल चुनें।", "انقر أدناه لتعيين المقياس أو اختر أداة المعايرة من اللوحة الجانبية."],
  ["Click and drag a tight box around one example. The CV pipeline finds all visual matches and shows them in a review modal.", "Haz clic y arrastra un recuadro ajustado alrededor de un ejemplo. El flujo CV encuentra coincidencias visuales y las muestra en un modal de revisión.", "Cliquez-glissez un cadre serré autour d’un exemple. Le pipeline CV trouve les correspondances visuelles et les affiche dans une fenêtre de révision.", "Einen engen Rahmen um ein Beispiel ziehen. Die CV-Pipeline findet visuelle Treffer und zeigt sie in einem Prüfmodal.", "Clique e arraste uma caixa justa em torno de um exemplo. O pipeline de CV encontra correspondências visuais e mostra em um modal de revisão.", "在一个示例周围拖出紧密框选。CV 流程会查找所有视觉匹配并在审核窗口中显示。", "例の周囲をぴったりドラッグします。CV パイプラインが一致を見つけ、レビュー画面に表示します。", "예시 하나를 촘촘히 드래그해 박스로 지정합니다. CV 파이프라인이 시각적 일치를 찾아 검토 모달에 표시합니다.", "एक उदाहरण के चारों ओर सटीक बॉक्स खींचें। CV पाइपलाइन सभी दृश्य मिलान ढूँढकर समीक्षा मोडल में दिखाती है।", "انقر واسحب مربعًا محكمًا حول مثال واحد. يعثر مسار الرؤية على كل المطابقات المرئية ويعرضها في نافذة مراجعة."],
  ["Select a drawing to begin takeoff", "Selecciona un plano para comenzar la medición", "Sélectionnez un dessin pour commencer le métré", "Zeichnung auswählen, um das Aufmaß zu beginnen", "Selecione um desenho para iniciar o levantamento", "选择图纸开始算量", "図面を選択して拾い出しを開始", "도면을 선택해 물량 산출 시작", "टेकऑफ शुरू करने के लिए ड्रॉइंग चुनें", "اختر رسمًا لبدء حصر الكميات"],
  ["Upload drawings via the Documents tab, then select one here to start measuring.", "Sube planos en la pestaña Documentos y luego selecciona uno aquí para empezar a medir.", "Téléversez les dessins dans l’onglet Documents, puis sélectionnez-en un ici pour commencer les mesures.", "Zeichnungen über den Dokumente-Tab hochladen und hier eine zum Messen auswählen.", "Envie desenhos pela aba Documentos e selecione um aqui para começar a medir.", "通过“文档”标签上传图纸，然后在此选择一个开始测量。", "ドキュメントタブで図面をアップロードし、ここで選択して測定を開始します。", "문서 탭에서 도면을 업로드한 뒤 여기에서 선택해 측정을 시작하세요.", "Documents टैब से ड्रॉइंग अपलोड करें, फिर माप शुरू करने के लिए यहाँ चुनें।", "حمّل الرسومات عبر تبويب المستندات ثم اختر واحدًا هنا لبدء القياس."],
  ["Compare a measurement against a known dimension to spot calibration drift.", "Compara una medición con una dimensión conocida para detectar desviaciones de calibración.", "Comparer une mesure à une dimension connue pour repérer une dérive de calibrage.", "Eine Messung mit einer bekannten Abmessung vergleichen, um Kalibrierabweichungen zu erkennen.", "Compare uma medição com uma dimensão conhecida para detectar desvio de calibração.", "将测量值与已知尺寸比较以发现校准偏差。", "測定値を既知寸法と比較して校正のずれを見つけます。", "측정값을 알려진 치수와 비교해 보정 오차를 찾습니다.", "कैलिब्रेशन drift पहचानने के लिए माप की तुलना ज्ञात आयाम से करें।", "قارن قياسًا ببعد معروف لاكتشاف انحراف المعايرة."],
  ["No scale notation found on this page. Use the manual presets below.", "No se encontró notación de escala en esta página. Usa los preajustes manuales abajo.", "Aucune notation d’échelle trouvée sur cette page. Utilisez les préréglages manuels ci-dessous.", "Keine Maßstabsangabe auf dieser Seite gefunden. Die manuellen Voreinstellungen unten verwenden.", "Nenhuma notação de escala encontrada nesta página. Use as predefinições manuais abaixo.", "此页面未找到比例标注。请使用下方手动预设。", "このページにスケール表記が見つかりません。下の手動プリセットを使用してください。", "이 페이지에서 축척 표기를 찾지 못했습니다. 아래 수동 프리셋을 사용하세요.", "इस पेज पर कोई स्केल नोटेशन नहीं मिला। नीचे मैनुअल प्रीसेट उपयोग करें।", "لم يتم العثور على ترميز مقياس في هذه الصفحة. استخدم الإعدادات اليدوية أدناه."],
  ["Quote-level modifiers, alternates, allowances, and custom totals that feed into the final quoted total.", "Modificadores de cotización, alternativos, asignaciones y totales personalizados que alimentan el total final cotizado.", "Modificateurs de devis, variantes, provisions et totaux personnalisés alimentant le total final du devis.", "Angebotsweite Modifikatoren, Alternativen, Zulagen und benutzerdefinierte Summen für die endgültige Angebotssumme.", "Modificadores da cotação, alternativas, verbas e totais personalizados que alimentam o total final cotado.", "影响最终报价总额的报价级调整、备选项、暂列金额和自定义总计。", "最終見積合計に反映される見積レベルの修正、代替案、許容額、カスタム合計。", "최종 견적 총액에 반영되는 견적 수준 수정, 대안, 허용액, 사용자 지정 합계입니다.", "अंतिम कोटेड कुल में जुड़ने वाले कोटेशन-स्तर संशोधक, विकल्प, भत्ते और कस्टम कुल।", "معدلات وبدائل ومخصصات وإجماليات مخصصة على مستوى العرض تدخل في إجمالي العرض النهائي."],
  ["Choose how the factor-adjusted line subtotal is organized before quote-level adjustments.", "Elige cómo se organiza el subtotal de líneas ajustado por factores antes de los ajustes de cotización.", "Choisissez comment le sous-total des lignes ajusté par facteurs est organisé avant les ajustements de devis.", "Festlegen, wie die faktorbereinigte Zeilensumme vor Angebotsanpassungen organisiert wird.", "Escolha como o subtotal das linhas ajustado por fatores é organizado antes dos ajustes da cotação.", "选择在报价级调整前如何组织经过系数调整的明细小计。", "見積レベル調整前に、係数調整済み行小計をどう整理するか選択します。", "견적 수준 조정 전에 계수 조정 라인 소계를 구성하는 방식을 선택하세요.", "कोटेशन-स्तर समायोजन से पहले factor-adjusted लाइन subtotal कैसे व्यवस्थित होगा चुनें।", "اختر كيفية تنظيم المجموع الفرعي للبنود المعدل بالعوامل قبل تعديلات العرض."],
  ["Read-only audit from direct cost through factors, line subtotal, adjustments, and customer total.", "Auditoría de solo lectura desde costo directo hasta factores, subtotal de líneas, ajustes y total del cliente.", "Audit en lecture seule du coût direct aux facteurs, sous-total des lignes, ajustements et total client.", "Schreibgeschützte Prüfung von Direktkosten über Faktoren, Zeilensumme, Anpassungen bis Kundensumme.", "Auditoria somente leitura do custo direto aos fatores, subtotal das linhas, ajustes e total do cliente.", "从直接成本到系数、明细小计、调整和客户总额的只读审计。", "直接原価から係数、行小計、調整、顧客合計までの読み取り専用監査。", "직접 비용부터 계수, 라인 소계, 조정, 고객 총액까지의 읽기 전용 감사입니다.", "प्रत्यक्ष लागत से कारक, लाइन subtotal, समायोजन और ग्राहक कुल तक read-only ऑडिट।", "تدقيق للقراءة فقط من التكلفة المباشرة عبر العوامل والمجموع الفرعي والتعديلات وإجمالي العميل."],
  ["No estimate factors or quote adjustments in the price build.", "No hay factores de estimación ni ajustes de cotización en la construcción de precio.", "Aucun facteur d’estimation ni ajustement de devis dans la construction du prix.", "Keine Kalkulationsfaktoren oder Angebotsanpassungen im Preisaufbau.", "Nenhum fator de estimativa ou ajuste da cotação na composição de preço.", "价格构成中没有估算系数或报价调整。", "価格構成に見積係数または見積調整はありません。", "가격 구성에 견적 계수나 견적 조정이 없습니다.", "मूल्य निर्माण में कोई अनुमान कारक या कोटेशन समायोजन नहीं है।", "لا توجد عوامل تقدير أو تعديلات عرض في بناء السعر."],
  ["Enter overhead, profit, tax, allowances, alternates, and custom totals after the base estimate.", "Ingresa gastos generales, utilidad, impuestos, asignaciones, alternativos y totales personalizados después de la estimación base.", "Saisissez frais généraux, profit, taxes, provisions, variantes et totaux personnalisés après l’estimation de base.", "Gemeinkosten, Gewinn, Steuer, Zulagen, Alternativen und benutzerdefinierte Summen nach der Basiskalkulation eingeben.", "Insira overhead, lucro, imposto, verbas, alternativas e totais personalizados após a estimativa base.", "在基础估算后输入管理费、利润、税、暂列金额、备选项和自定义总计。", "基本見積の後に間接費、利益、税、許容額、代替案、カスタム合計を入力します。", "기본 견적 후 간접비, 이익, 세금, 허용액, 대안 및 사용자 지정 합계를 입력하세요.", "बेस अनुमान के बाद overhead, profit, tax, allowances, alternates और custom totals दर्ज करें।", "أدخل المصاريف العامة والربح والضريبة والمخصصات والبدائل والإجماليات المخصصة بعد التقدير الأساسي."],
  ["No resource composition has been captured yet.", "Aún no se ha capturado composición de recursos.", "Aucune composition de ressources n’a encore été capturée.", "Noch keine Ressourcenzusammensetzung erfasst.", "Nenhuma composição de recursos foi capturada ainda.", "尚未捕获资源组成。", "リソース構成はまだ取得されていません。", "아직 리소스 구성이 캡처되지 않았습니다.", "अभी कोई संसाधन संरचना कैप्चर नहीं हुई है।", "لم يتم التقاط أي تركيب موارد بعد."],
  ["No resources match the current filters.", "Ningún recurso coincide con los filtros actuales.", "Aucune ressource ne correspond aux filtres actuels.", "Keine Ressourcen entsprechen den aktuellen Filtern.", "Nenhum recurso corresponde aos filtros atuais.", "没有资源匹配当前筛选器。", "現在のフィルターに一致するリソースはありません。", "현재 필터와 일치하는 리소스가 없습니다.", "वर्तमान फ़िल्टर से कोई संसाधन मेल नहीं खाता।", "لا توجد موارد تطابق المرشحات الحالية."],
  ["Add sections below to create a comprehensive report", "Agrega secciones abajo para crear un informe completo", "Ajoutez des sections ci-dessous pour créer un rapport complet", "Unten Abschnitte hinzufügen, um einen vollständigen Bericht zu erstellen", "Adicione seções abaixo para criar um relatório abrangente", "在下方添加章节以创建完整报告", "下にセクションを追加して包括的なレポートを作成", "아래에 섹션을 추가해 종합 보고서를 만드세요", "व्यापक रिपोर्ट बनाने के लिए नीचे अनुभाग जोड़ें", "أضف أقسامًا أدناه لإنشاء تقرير شامل"],
  ["Internal estimator notes and scratch work...", "Notas internas del estimador y borradores...", "Notes internes de l’estimateur et brouillon...", "Interne Kalkulatornotizen und Entwürfe...", "Notas internas do estimador e rascunhos...", "内部估算员备注和草稿...", "内部見積メモと下書き...", "내부 견적자 메모 및 초안...", "आंतरिक अनुमानकर्ता नोट्स और scratch work...", "ملاحظات المقدّر الداخلية ومسودات العمل..."],
  ["Start Building Your Report", "Comienza a crear tu informe", "Commencer votre rapport", "Bericht erstellen", "Comece a criar seu relatório", "开始构建报告", "レポート作成を開始", "보고서 작성 시작", "अपनी रिपोर्ट बनाना शुरू करें", "ابدأ بناء تقريرك"],
  ["Connect this takeoff mark&rsquo;s measurement to a worksheet line item", "Conecta la medición de esta marca de medición con una partida de hoja", "Relier la mesure de cette marque de métré à une ligne de feuille", "Messung dieser Aufmaßmarke mit einer Arbeitsblattposition verknüpfen", "Conecte a medição desta marca de levantamento a um item da planilha", "将此算量标记的测量连接到工作表明细项", "この拾い出しマークの測定値をワークシート明細に接続", "이 물량 산출 마크의 측정값을 워크시트 라인 항목에 연결", "इस टेकऑफ मार्क के माप को वर्कशीट लाइन आइटम से जोड़ें", "اربط قياس علامة الحصر هذه ببند في ورقة العمل"],
  ["Select a tool and click on the drawing to start measuring", "Selecciona una herramienta y haz clic en el plano para comenzar a medir", "Sélectionnez un outil et cliquez sur le dessin pour commencer à mesurer", "Werkzeug auswählen und auf die Zeichnung klicken, um zu messen", "Selecione uma ferramenta e clique no desenho para começar a medir", "选择工具并点击图纸开始测量", "ツールを選択し図面をクリックして測定を開始", "도구를 선택하고 도면을 클릭해 측정을 시작하세요", "एक उपकरण चुनें और माप शुरू करने के लिए ड्रॉइंग पर क्लिक करें", "اختر أداة وانقر على الرسم لبدء القياس"],
  ["This plugin search action is missing its tool metadata.", "A esta acción de búsqueda de plugin le faltan metadatos de herramienta.", "Cette action de recherche de module manque de métadonnées d’outil.", "Dieser Plugin-Suchaktion fehlen Werkzeugmetadaten.", "Esta ação de busca do plugin não tem metadados da ferramenta.", "此插件搜索操作缺少工具元数据。", "このプラグイン検索アクションにはツールメタデータがありません。", "이 플러그인 검색 작업에 도구 메타데이터가 없습니다.", "इस प्लगइन खोज क्रिया में टूल मेटाडेटा नहीं है।", "يفتقد إجراء بحث المكوّن الإضافي هذا بيانات تعريف الأداة."],
  ["Type at least 2 characters before searching an external provider.", "Escribe al menos 2 caracteres antes de buscar en un proveedor externo.", "Saisissez au moins 2 caractères avant de rechercher un fournisseur externe.", "Vor der Suche bei einem externen Anbieter mindestens 2 Zeichen eingeben.", "Digite pelo menos 2 caracteres antes de buscar em um provedor externo.", "搜索外部提供商前至少输入 2 个字符。", "外部プロバイダーを検索する前に2文字以上入力してください。", "외부 공급자를 검색하기 전에 최소 2자를 입력하세요.", "बाहरी प्रदाता खोजने से पहले कम से कम 2 अक्षर लिखें।", "اكتب حرفين على الأقل قبل البحث لدى مزود خارجي."],
  ["All estimate search sources are disabled for this quote.", "Todas las fuentes de búsqueda de estimación están desactivadas para esta cotización.", "Toutes les sources de recherche d’estimation sont désactivées pour ce devis.", "Alle Kalkulationssuchquellen sind für dieses Angebot deaktiviert.", "Todas as fontes de busca de estimativa estão desativadas para esta cotação.", "此报价已禁用所有估算搜索来源。", "この見積ではすべての見積検索ソースが無効です。", "이 견적의 모든 견적 검색 소스가 비활성화되었습니다.", "इस कोटेशन के लिए सभी अनुमान खोज स्रोत अक्षम हैं।", "تم تعطيل كل مصادر بحث التقدير لهذا العرض."],
  ["Search every indexed source, select many rows, or open assemblies and plugin tools from here.", "Busca en todas las fuentes indexadas, selecciona varias filas o abre ensamblajes y herramientas de plugin desde aquí.", "Recherchez dans toutes les sources indexées, sélectionnez plusieurs lignes ou ouvrez assemblages et outils de module ici.", "Alle indexierten Quellen durchsuchen, mehrere Zeilen auswählen oder Baugruppen und Plugin-Werkzeuge von hier öffnen.", "Busque em todas as fontes indexadas, selecione várias linhas ou abra montagens e ferramentas de plugin daqui.", "搜索所有已索引来源，选择多行，或从此打开组件和插件工具。", "すべてのインデックス済みソースを検索し、複数行を選択し、ここからアセンブリやプラグインツールを開けます。", "모든 색인 소스를 검색하고 여러 행을 선택하거나 여기서 어셈블리와 플러그인 도구를 여세요.", "हर indexed स्रोत खोजें, कई पंक्तियाँ चुनें, या यहाँ से assemblies और plugin tools खोलें।", "ابحث في كل مصدر مفهرس وحدد عدة صفوف أو افتح التجميعات وأدوات المكونات الإضافية من هنا."],
  ["Primary quote package for client delivery", "Paquete principal de cotización para entregar al cliente", "Paquet de devis principal pour livraison au client", "Primäres Angebotspaket für die Kundenausgabe", "Pacote principal da cotação para entrega ao cliente", "用于客户交付的主要报价包", "顧客提出用の主要見積パッケージ", "고객 전달용 기본 견적 패키지", "ग्राहक डिलीवरी के लिए प्राथमिक कोटेशन पैकेज", "حزمة العرض الأساسية لتسليم العميل"],
  ["Detailed backup with worksheet pricing detail", "Respaldo detallado con precios de hoja", "Sauvegarde détaillée avec prix par feuille", "Detaillierte Sicherung mit Arbeitsblattpreisen", "Backup detalhado com preços da planilha", "包含工作表价格明细的详细备份", "ワークシート価格詳細付きの詳細バックアップ", "워크시트 가격 상세가 포함된 세부 백업", "वर्कशीट मूल्य विवरण सहित विस्तृत बैकअप", "نسخة احتياطية مفصلة مع تفاصيل تسعير ورقة العمل"],
  ["Field/site issue version of the quote", "Versión de campo/sitio de la cotización", "Version chantier/site du devis", "Feld-/Standortversion des Angebots", "Versão de campo/local da cotação", "报价的现场版本", "見積の現場版", "견적의 현장/사이트 버전", "कोटेशन का फ़ील्ड/साइट संस्करण", "إصدار ميداني/موقعي من العرض"],
  ["Closeout package without estimate detail", "Paquete de cierre sin detalle de estimación", "Dossier de clôture sans détail d’estimation", "Abschlusspaket ohne Kalkulationsdetails", "Pacote de encerramento sem detalhe de estimativa", "不含估算明细的收尾包", "見積詳細なしのクローズアウトパッケージ", "견적 상세가 없는 마감 패키지", "अनुमान विवरण के बिना closeout पैकेज", "حزمة إغلاق بدون تفاصيل التقدير"],
  ["Project schedule and task sequence", "Programa del proyecto y secuencia de tareas", "Calendrier du projet et séquence des tâches", "Projektterminplan und Aufgabenfolge", "Cronograma do projeto e sequência de tarefas", "项目计划和任务顺序", "プロジェクトスケジュールとタスク順序", "프로젝트 일정 및 작업 순서", "प्रोजेक्ट शेड्यूल और कार्य क्रम", "جدول المشروع وتسلسل المهام"],
  ["Organization branding is pulled automatically from settings.", "La marca de la organización se toma automáticamente de la configuración.", "L’image de marque de l’organisation est reprise automatiquement des paramètres.", "Organisationsbranding wird automatisch aus den Einstellungen übernommen.", "A marca da organização é puxada automaticamente das configurações.", "组织品牌会自动从设置中获取。", "組織ブランディングは設定から自動取得されます。", "조직 브랜딩은 설정에서 자동으로 가져옵니다.", "संगठन branding सेटिंग्स से स्वतः ली जाती है।", "يتم جلب هوية المؤسسة تلقائيًا من الإعدادات."],
  ["Drag this section in the list above to place it anywhere in the PDF.", "Arrastra esta sección en la lista superior para ubicarla en cualquier lugar del PDF.", "Faites glisser cette section dans la liste ci-dessus pour la placer n’importe où dans le PDF.", "Diesen Abschnitt in der Liste oben ziehen, um ihn beliebig im PDF zu platzieren.", "Arraste esta seção na lista acima para posicioná-la em qualquer lugar do PDF.", "在上方列表中拖动此章节，可将其放在 PDF 任意位置。", "上のリストでこのセクションをドラッグしてPDF内の任意の場所に配置します。", "위 목록에서 이 섹션을 드래그해 PDF 어디든 배치하세요.", "PDF में कहीं भी रखने के लिए ऊपर सूची में इस अनुभाग को खींचें।", "اسحب هذا القسم في القائمة أعلاه لوضعه في أي مكان داخل PDF."],
  ["Header uses the organization name and quote number automatically.", "El encabezado usa automáticamente el nombre de la organización y el número de cotización.", "L’en-tête utilise automatiquement le nom de l’organisation et le numéro du devis.", "Die Kopfzeile verwendet automatisch Organisationsname und Angebotsnummer.", "O cabeçalho usa automaticamente o nome da organização e o número da cotação.", "页眉会自动使用组织名称和报价编号。", "ヘッダーは組織名と見積番号を自動使用します。", "머리글은 조직 이름과 견적 번호를 자동으로 사용합니다.", "हेडर संगठन नाम और कोटेशन नंबर स्वतः उपयोग करता है।", "يستخدم الرأس اسم المؤسسة ورقم العرض تلقائيًا."],
  ["Footer uses the organization website and issue date automatically.", "El pie usa automáticamente el sitio web de la organización y la fecha de emisión.", "Le pied de page utilise automatiquement le site Web de l’organisation et la date d’émission.", "Die Fußzeile verwendet automatisch Organisationswebsite und Ausgabedatum.", "O rodapé usa automaticamente o site da organização e a data de emissão.", "页脚会自动使用组织网站和发布日期。", "フッターは組織Webサイトと発行日を自動使用します。", "바닥글은 조직 웹사이트와 발행일을 자동으로 사용합니다.", "फुटर संगठन वेबसाइट और जारी तिथि स्वतः उपयोग करता है।", "يستخدم التذييل موقع المؤسسة وتاريخ الإصدار تلقائيًا."],
  ["Internal mode — cost, markup, margin & profit are visible. Do not share with customers.", "Modo interno: costo, markup, margen y utilidad son visibles. No compartir con clientes.", "Mode interne : coût, majoration, marge et profit sont visibles. Ne pas partager avec les clients.", "Interner Modus: Kosten, Aufschlag, Marge und Gewinn sind sichtbar. Nicht mit Kunden teilen.", "Modo interno: custo, markup, margem e lucro estão visíveis. Não compartilhe com clientes.", "内部模式：成本、加价、利润率和利润可见。请勿与客户共享。", "内部モード: 原価、マークアップ、マージン、利益が表示されます。顧客と共有しないでください。", "내부 모드: 비용, 마크업, 마진, 이익이 표시됩니다. 고객과 공유하지 마세요.", "आंतरिक मोड: लागत, markup, margin और profit दिखते हैं। ग्राहकों से साझा न करें।", "الوضع الداخلي: التكلفة والزيادة والهامش والربح ظاهرة. لا تشاركها مع العملاء."],
  ["General", "General", "Général", "Allgemein", "Geral", "常规", "一般", "일반", "सामान्य", "عام"],
  ["Conditions", "Condiciones", "Conditions", "Bedingungen", "Condições", "条件", "条件", "조건", "शर्तें", "الشروط"],
  ["Notes", "Notas", "Notes", "Notizen", "Notas", "备注", "メモ", "메모", "नोट्स", "الملاحظات"],
  ["Rates", "Tarifas", "Taux", "Sätze", "Taxas", "费率", "レート", "요율", "दरें", "الأسعار"],
  ["Quality", "Calidad", "Qualité", "Qualität", "Qualidade", "质量", "品質", "품질", "गुणवत्ता", "الجودة"],
  ["Quote Details", "Detalles de cotización", "Détails du devis", "Angebotsdetails", "Detalhes da cotação", "报价详情", "見積詳細", "견적 세부 정보", "कोटेशन विवरण", "تفاصيل العرض"],
  ["Quote Title", "Título de cotización", "Titre du devis", "Angebotstitel", "Título da cotação", "报价标题", "見積タイトル", "견적 제목", "कोटेशन शीर्षक", "عنوان العرض"],
  ["Quote title", "Título de cotización", "Titre du devis", "Angebotstitel", "Título da cotação", "报价标题", "見積タイトル", "견적 제목", "कोटेशन शीर्षक", "عنوان العرض"],
  ["Contact", "Contacto", "Contact", "Kontakt", "Contato", "联系人", "連絡先", "연락처", "संपर्क", "جهة الاتصال"],
  ["Department", "Departamento", "Service", "Abteilung", "Departamento", "部门", "部門", "부서", "विभाग", "القسم"],
  ["Type", "Tipo", "Type", "Typ", "Tipo", "类型", "種類", "유형", "प्रकार", "النوع"],
  ["New client name", "Nuevo nombre de cliente", "Nouveau nom du client", "Neuer Kundenname", "Novo nome do cliente", "新客户名称", "新しい顧客名", "새 고객 이름", "नया ग्राहक नाम", "اسم عميل جديد"],
  ["Add new client", "Agregar cliente nuevo", "Ajouter un nouveau client", "Neuen Kunden hinzufügen", "Adicionar novo cliente", "添加新客户", "新しい顧客を追加", "새 고객 추가", "नया ग्राहक जोड़ें", "إضافة عميل جديد"],
  ["New contact name", "Nuevo nombre de contacto", "Nouveau nom du contact", "Neuer Kontaktname", "Novo nome do contato", "新联系人姓名", "新しい連絡先名", "새 연락처 이름", "नया संपर्क नाम", "اسم جهة اتصال جديدة"],
  ["Select contact...", "Seleccionar contacto...", "Sélectionner un contact...", "Kontakt auswählen...", "Selecionar contato...", "选择联系人...", "連絡先を選択...", "연락처 선택...", "संपर्क चुनें...", "اختر جهة الاتصال..."],
  ["Add new contact", "Agregar contacto nuevo", "Ajouter un nouveau contact", "Neuen Kontakt hinzufügen", "Adicionar novo contato", "添加新联系人", "新しい連絡先を追加", "새 연락처 추가", "नया संपर्क जोड़ें", "إضافة جهة اتصال جديدة"],
  ["Select a client first", "Selecciona primero un cliente", "Sélectionnez d’abord un client", "Zuerst einen Kunden auswählen", "Selecione um cliente primeiro", "请先选择客户", "先に顧客を選択", "먼저 고객을 선택하세요", "पहले ग्राहक चुनें", "اختر العميل أولاً"],
  ["Select department...", "Seleccionar departamento...", "Sélectionner un service...", "Abteilung auswählen...", "Selecionar departamento...", "选择部门...", "部門を選択...", "부서 선택...", "विभाग चुनें...", "اختر القسم..."],
  ["Select type...", "Seleccionar tipo...", "Sélectionner un type...", "Typ auswählen...", "Selecionar tipo...", "选择类型...", "種類を選択...", "유형 선택...", "प्रकार चुनें...", "اختر النوع..."],
  ["Quote Date", "Fecha de cotización", "Date du devis", "Angebotsdatum", "Data da cotação", "报价日期", "見積日", "견적일", "कोटेशन तिथि", "تاريخ العرض"],
  ["Due Date", "Fecha de vencimiento", "Date d’échéance", "Fälligkeitsdatum", "Data de vencimento", "截止日期", "期限日", "마감일", "देय तिथि", "تاريخ الاستحقاق"],
  ["Description / Scope of Work", "Descripción / alcance de trabajo", "Description / portée des travaux", "Beschreibung / Leistungsumfang", "Descrição / escopo do trabalho", "描述 / 工作范围", "説明 / 作業範囲", "설명 / 작업 범위", "विवरण / कार्य दायरा", "الوصف / نطاق العمل"],
  ["Scope of work description...", "Descripción del alcance de trabajo...", "Description de la portée des travaux...", "Beschreibung des Leistungsumfangs...", "Descrição do escopo do trabalho...", "工作范围描述...", "作業範囲の説明...", "작업 범위 설명...", "कार्य दायरे का विवरण...", "وصف نطاق العمل..."],
  ["Customer-facing estimate notes...", "Notas de estimación para el cliente...", "Notes d’estimation destinées au client...", "Kundenorientierte Kalkulationsnotizen...", "Notas de estimativa para o cliente...", "面向客户的估算备注...", "顧客向け見積メモ...", "고객용 견적 메모...", "ग्राहक हेतु अनुमान नोट्स...", "ملاحظات تقدير موجهة للعميل..."],
  ["Inclusions", "Inclusiones", "Inclus", "Einschlüsse", "Inclusões", "包含项", "含まれる項目", "포함 사항", "शामिल मदें", "المشمولة"],
  ["Exclusions", "Exclusiones", "Exclus", "Ausschlüsse", "Exclusões", "排除项", "除外項目", "제외 사항", "बहिष्करण", "المستثناة"],
  ["Clarifications", "Aclaraciones", "Clarifications", "Klarstellungen", "Esclarecimentos", "澄清事项", "補足事項", "명확화", "स्पष्टीकरण", "التوضيحات"],
  ["Library", "Biblioteca", "Bibliothèque", "Bibliothek", "Biblioteca", "库", "ライブラリ", "라이브러리", "लाइब्रेरी", "المكتبة"],
  ["Condition Library —", "Biblioteca de condiciones:", "Bibliothèque de conditions :", "Bedingungsbibliothek:", "Biblioteca de condições:", "条件库：", "条件ライブラリ:", "조건 라이브러리:", "शर्त लाइब्रेरी:", "مكتبة الشروط:"],
  ["No library entries. Save conditions to build your reusable library.", "No hay entradas de biblioteca. Guarda condiciones para crear tu biblioteca reutilizable.", "Aucune entrée de bibliothèque. Enregistrez des conditions pour créer votre bibliothèque réutilisable.", "Keine Bibliothekseinträge. Speichern Sie Bedingungen, um Ihre wiederverwendbare Bibliothek aufzubauen.", "Nenhuma entrada na biblioteca. Salve condições para criar sua biblioteca reutilizável.", "没有库条目。保存条件以构建可复用库。", "ライブラリ項目がありません。条件を保存して再利用ライブラリを作成します。", "라이브러리 항목이 없습니다. 조건을 저장해 재사용 라이브러리를 만드세요.", "कोई लाइब्रेरी प्रविष्टि नहीं। पुन: उपयोग लाइब्रेरी बनाने के लिए शर्तें सहेजें।", "لا توجد إدخالات في المكتبة. احفظ الشروط لبناء مكتبتك القابلة لإعادة الاستخدام."],
  ["Use", "Usar", "Utiliser", "Verwenden", "Usar", "使用", "使用", "사용", "उपयोग करें", "استخدام"],
  ["No inclusions added", "No se agregaron inclusiones", "Aucun inclus ajouté", "Keine Einschlüsse hinzugefügt", "Nenhuma inclusão adicionada", "未添加包含项", "含まれる項目は未追加", "포함 사항이 추가되지 않음", "कोई शामिल मद नहीं जोड़ी गई", "لم تتم إضافة مشمولات"],
  ["No exclusions added", "No se agregaron exclusiones", "Aucun exclu ajouté", "Keine Ausschlüsse hinzugefügt", "Nenhuma exclusão adicionada", "未添加排除项", "除外項目は未追加", "제외 사항이 추가되지 않음", "कोई बहिष्करण नहीं जोड़ा गया", "لم تتم إضافة مستثنيات"],
  ["No clarifications added", "No se agregaron aclaraciones", "Aucune clarification ajoutée", "Keine Klarstellungen hinzugefügt", "Nenhum esclarecimento adicionado", "未添加澄清事项", "補足事項は未追加", "명확화가 추가되지 않음", "कोई स्पष्टीकरण नहीं जोड़ा गया", "لم تتم إضافة توضيحات"],
  ["Add inclusion...", "Agregar inclusión...", "Ajouter un inclus...", "Einschluss hinzufügen...", "Adicionar inclusão...", "添加包含项...", "含まれる項目を追加...", "포함 사항 추가...", "शामिल मद जोड़ें...", "إضافة مشمول..."],
  ["Add exclusion...", "Agregar exclusión...", "Ajouter un exclu...", "Ausschluss hinzufügen...", "Adicionar exclusão...", "添加排除项...", "除外項目を追加...", "제외 사항 추가...", "बहिष्करण जोड़ें...", "إضافة مستثنى..."],
  ["Add clarification...", "Agregar aclaración...", "Ajouter une clarification...", "Klarstellung hinzufügen...", "Adicionar esclarecimento...", "添加澄清事项...", "補足事項を追加...", "명확화 추가...", "स्पष्टीकरण जोड़ें...", "إضافة توضيح..."],
  ["Save to library", "Guardar en biblioteca", "Enregistrer dans la bibliothèque", "In Bibliothek speichern", "Salvar na biblioteca", "保存到库", "ライブラリに保存", "라이브러리에 저장", "लाइब्रेरी में सहेजें", "حفظ في المكتبة"],
  ["Rate Schedules", "Programas de tarifas", "Barèmes de taux", "Tarifpläne", "Tabelas de taxas", "费率计划", "レートスケジュール", "요율표", "दर अनुसूचियाँ", "جداول الأسعار"],
  ["Import from Library", "Importar desde biblioteca", "Importer depuis la bibliothèque", "Aus Bibliothek importieren", "Importar da biblioteca", "从库导入", "ライブラリからインポート", "라이브러리에서 가져오기", "लाइब्रेरी से आयात करें", "استيراد من المكتبة"],
  ["No rate schedules imported. Import from your organization's rate library.", "No se importaron programas de tarifas. Importa desde la biblioteca de tarifas de tu organización.", "Aucun barème importé. Importez depuis la bibliothèque de taux de votre organisation.", "Keine Tarifpläne importiert. Importieren Sie aus der Tarifbibliothek Ihrer Organisation.", "Nenhuma tabela de taxas importada. Importe da biblioteca de taxas da sua organização.", "未导入费率计划。请从组织的费率库导入。", "レートスケジュールがインポートされていません。組織のレートライブラリからインポートしてください。", "가져온 요율표가 없습니다. 조직의 요율 라이브러리에서 가져오세요.", "कोई दर अनुसूची आयात नहीं हुई। अपने संगठन की दर लाइब्रेरी से आयात करें।", "لم يتم استيراد جداول أسعار. استورد من مكتبة أسعار مؤسستك."],
  ["No rate items in this schedule.", "No hay partidas de tarifa en este programa.", "Aucun article de taux dans ce barème.", "Keine Tarifpositionen in diesem Plan.", "Nenhum item de taxa nesta tabela.", "此计划中没有费率项。", "このスケジュールにレート項目はありません。", "이 요율표에 요율 항목이 없습니다.", "इस अनुसूची में कोई दर आइटम नहीं है।", "لا توجد بنود أسعار في هذا الجدول."],
  ["Cost Rates", "Tarifas de costo", "Taux de coût", "Kostensätze", "Taxas de custo", "成本费率", "原価レート", "원가 요율", "लागत दरें", "أسعار التكلفة"],
  ["Estimate Search", "Búsqueda de estimación", "Recherche d’estimation", "Kalkulationssuche", "Busca da estimativa", "估算搜索", "見積検索", "견적 검색", "अनुमान खोज", "بحث التقدير"],
  ["Quote-level controls for line item search sources, catalog visibility, and labour unit libraries.", "Controles de cotización para fuentes de búsqueda de partidas, visibilidad de catálogos y bibliotecas de unidades de mano de obra.", "Contrôles au niveau du devis pour les sources de recherche de lignes, la visibilité des catalogues et les bibliothèques d’unités de main-d’œuvre.", "Angebotsweite Steuerung für Positionssuchquellen, Katalogsichtbarkeit und Arbeitseinheitenbibliotheken.", "Controles da cotação para fontes de busca de linhas, visibilidade de catálogos e bibliotecas de unidades de mão de obra.", "报价级控件，用于明细项搜索来源、目录可见性和人工单位库。", "明細検索ソース、カタログ表示、労務単位ライブラリの見積レベル制御。", "라인 항목 검색 소스, 카탈로그 표시, 노무 단위 라이브러리를 위한 견적 수준 제어입니다.", "लाइन आइटम खोज स्रोतों, कैटलॉग दृश्यता और श्रम इकाई लाइब्रेरी के लिए कोटेशन-स्तर नियंत्रण।", "عناصر تحكم على مستوى العرض لمصادر بحث البنود وظهور الكتالوجات ومكتبات وحدات العمالة."],
  ["Sources", "Fuentes", "Sources", "Quellen", "Fontes", "来源", "ソース", "소스", "स्रोत", "المصادر"],
  ["enabled", "activado", "activé", "aktiviert", "ativado", "已启用", "有効", "활성화됨", "सक्षम", "مفعل"],
  ["visible", "visible", "visible", "sichtbar", "visível", "可见", "表示", "표시", "दृश्यमान", "مرئي"],
  ["source types on", "tipos de fuente activos", "types de source activés", "Quellentypen aktiv", "tipos de fonte ativos", "来源类型已开启", "ソース種別が有効", "소스 유형 켜짐", "स्रोत प्रकार चालू", "أنواع مصادر مفعلة"],
  ["task", "tarea", "tâche", "Aufgabe", "tarefa", "任务", "タスク", "작업", "कार्य", "مهمة"],
  ["tasks", "tareas", "tâches", "Aufgaben", "tarefas", "任务", "タスク", "작업", "कार्य", "مهام"],
  ["unit", "unidad", "unité", "Einheit", "unidade", "单位", "単位", "단위", "इकाई", "وحدة"],
  ["units", "unidades", "unités", "Einheiten", "unidades", "单位", "単位", "단위", "इकाइयाँ", "وحدات"],
  ["Labour units", "Unidades de mano de obra", "Unités de main-d’œuvre", "Arbeitseinheiten", "Unidades de mão de obra", "人工单位", "労務単位", "노무 단위", "श्रम इकाइयाँ", "وحدات العمالة"],
  ["Labour Unit Libraries", "Bibliotecas de unidades de mano de obra", "Bibliothèques d’unités de main-d’œuvre", "Arbeitseinheitenbibliotheken", "Bibliotecas de unidades de mão de obra", "人工单位库", "労務単位ライブラリ", "노무 단위 라이브러리", "श्रम इकाई लाइब्रेरी", "مكتبات وحدات العمالة"],
  ["Imported rate books", "Libros de tarifas importados", "Livres de taux importés", "Importierte Satzbücher", "Livros de taxas importados", "已导入费率书", "インポート済みレートブック", "가져온 요율표", "आयातित दर पुस्तिकाएँ", "دفاتر أسعار مستوردة"],
  ["Quote-linked labour and equipment rates.", "Tarifas de mano de obra y equipo vinculadas a la cotización.", "Taux de main-d’œuvre et d’équipement liés au devis.", "Mit dem Angebot verknüpfte Arbeits- und Gerätesätze.", "Taxas de mão de obra e equipamento vinculadas à cotação.", "与报价关联的人工和设备费率。", "見積に紐づく労務・設備レート。", "견적에 연결된 노무 및 장비 요율입니다.", "कोटेशन से जुड़ी श्रम और उपकरण दरें।", "أسعار العمالة والمعدات المرتبطة بالعرض."],
  ["Catalogs", "Catálogos", "Catalogues", "Kataloge", "Catálogos", "目录", "カタログ", "카탈로그", "कैटलॉग", "الكتالوجات"],
  ["Catalog items.", "Elementos de catálogo.", "Articles de catalogue.", "Katalogpositionen.", "Itens de catálogo.", "目录项。", "カタログ項目。", "카탈로그 항목입니다.", "कैटलॉग आइटम।", "بنود الكتالوج."],
  ["Catalog items", "Elementos de catálogo", "Articles de catalogue", "Katalogpositionen", "Itens de catálogo", "目录项", "カタログ項目", "카탈로그 항목", "कैटलॉग आइटम", "بنود الكتالوج"],
  ["Library catalog items.", "Partidas de catálogos de biblioteca.", "Articles de catalogue de bibliothèque.", "Bibliothekskatalogpositionen.", "Itens de catálogo da biblioteca.", "库目录项。", "ライブラリカタログ項目。", "라이브러리 카탈로그 항목입니다.", "लाइब्रेरी कैटलॉग आइटम।", "بنود كتالوج المكتبة."],
  ["Production units, crews, and rate-book prompts.", "Unidades de producción, cuadrillas y sugerencias de libros de tarifas.", "Unités de production, équipes et invites de livres de taux.", "Produktionseinheiten, Kolonnen und Satzbuchabfragen.", "Unidades de produção, equipes e prompts de livros de taxas.", "生产单位、班组和费率书提示。", "生産単位、クルー、レートブック候補。", "생산 단위, 작업조 및 요율표 프롬프트입니다.", "उत्पादन इकाइयाँ, दल और दर पुस्तिका संकेत।", "وحدات الإنتاج والفرق ومطالبات دفاتر الأسعار."],
  ["Cost intelligence", "Inteligencia de costos", "Info coûts", "Kostenintelligenz", "Inteligência de custos", "成本情报", "コスト情報", "비용 정보", "लागत इंटेलिजेंस", "معلومات التكلفة"],
  ["Effective vendor and market cost observations.", "Observaciones efectivas de costos de proveedores y mercado.", "Observations de coûts fournisseurs et marché effectives.", "Wirksame Lieferanten- und Marktkostenbeobachtungen.", "Observações efetivas de custos de fornecedores e mercado.", "有效的供应商和市场成本观察。", "有効なベンダーおよび市場コスト観測。", "유효한 공급업체 및 시장 비용 관측입니다.", "प्रभावी विक्रेता और बाजार लागत अवलोकन।", "ملاحظات فعالة لتكاليف الموردين والسوق."],
  ["Saved build-ups and multi-line selections.", "Desgloses guardados y selecciones de varias líneas.", "Compositions enregistrées et sélections multilignes.", "Gespeicherte Aufbauten und Mehrfachpositionsauswahlen.", "Composições salvas e seleções de várias linhas.", "已保存的组合和多行选择。", "保存済みの積算構成と複数行選択。", "저장된 구성 및 다중 라인 선택입니다.", "सहेजे गए बिल्ड-अप और बहु-लाइन चयन।", "تركيبات محفوظة وتحديدات متعددة البنود."],
  ["Plugin calculators", "Calculadoras de plugin", "Calculateurs de module", "Plugin-Rechner", "Calculadoras de plugin", "插件计算器", "プラグイン計算機", "플러그인 계산기", "प्लगइन कैलकुलेटर", "حاسبات المكونات الإضافية"],
  ["Tools that create worksheet lines when searched by name.", "Herramientas que crean líneas de hoja al buscarlas por nombre.", "Outils qui créent des lignes de feuille lorsqu’ils sont recherchés par nom.", "Werkzeuge, die bei Namenssuche Arbeitsblattzeilen erstellen.", "Ferramentas que criam linhas da planilha quando pesquisadas por nome.", "按名称搜索时可创建工作表行的工具。", "名前検索でワークシート行を作成するツール。", "이름으로 검색하면 워크시트 라인을 만드는 도구입니다.", "नाम से खोजने पर वर्कशीट लाइनें बनाने वाले उपकरण।", "أدوات تنشئ أسطر ورقة عمل عند البحث بالاسم."],
  ["catalog item", "elemento de catálogo", "article de catalogue", "Katalogposition", "item de catálogo", "目录项", "カタログ項目", "카탈로그 항목", "कैटलॉग आइटम", "بند كتالوج"],
  ["rate schedule item", "elemento de programa de tarifas", "article de barème", "Tarifplanposition", "item da tabela de taxas", "费率计划项", "レートスケジュール項目", "요율표 항목", "दर अनुसूची आइटम", "بند جدول أسعار"],
  ["labor unit", "unidad de mano de obra", "unité de main-d’œuvre", "Arbeitseinheit", "unidade de mão de obra", "人工单位", "労務単位", "노무 단위", "श्रम इकाई", "وحدة عمالة"],
  ["effective cost", "costo efectivo", "coût effectif", "effektive Kosten", "custo efetivo", "有效成本", "有効原価", "유효 비용", "प्रभावी लागत", "تكلفة فعلية"],
  ["plugin tool", "herramienta de plugin", "outil de module", "Plugin-Werkzeug", "ferramenta de plugin", "插件工具", "プラグインツール", "플러그인 도구", "प्लगइन उपकरण", "أداة مكون إضافي"],
  ["external action", "acción externa", "action externe", "externe Aktion", "ação externa", "外部操作", "外部アクション", "외부 작업", "बाहरी क्रिया", "إجراء خارجي"],
  ["Filter catalogs...", "Filtrar catálogos...", "Filtrer les catalogues...", "Kataloge filtern...", "Filtrar catálogos...", "筛选目录...", "カタログを絞り込み...", "카탈로그 필터...", "कैटलॉग फ़िल्टर करें...", "تصفية الكتالوجات..."],
  ["Filter libraries...", "Filtrar bibliotecas...", "Filtrer les bibliothèques...", "Bibliotheken filtern...", "Filtrar bibliotecas...", "筛选库...", "ライブラリを絞り込み...", "라이브러리 필터...", "लाइब्रेरी फ़िल्टर करें...", "تصفية المكتبات..."],
  ["Enable visible", "Activar visibles", "Activer les visibles", "Sichtbare aktivieren", "Ativar visíveis", "启用可见项", "表示項目を有効化", "표시 항목 활성화", "दृश्यमान सक्षम करें", "تفعيل الظاهرة"],
  ["Disable visible", "Desactivar visibles", "Désactiver les visibles", "Sichtbare deaktivieren", "Desativar visíveis", "禁用可见项", "表示項目を無効化", "표시 항목 비활성화", "दृश्यमान अक्षम करें", "تعطيل الظاهرة"],
  ["Source disabled", "Fuente desactivada", "Source désactivée", "Quelle deaktiviert", "Fonte desativada", "来源已禁用", "ソース無効", "소스 비활성화", "स्रोत अक्षम", "المصدر معطل"],
  ["No catalogs available.", "No hay catálogos disponibles.", "Aucun catalogue disponible.", "Keine Kataloge verfügbar.", "Nenhum catálogo disponível.", "没有可用目录。", "利用可能なカタログはありません。", "사용 가능한 카탈로그가 없습니다.", "कोई कैटलॉग उपलब्ध नहीं।", "لا توجد كتالوجات متاحة."],
  ["No catalogs match this filter.", "Ningún catálogo coincide con este filtro.", "Aucun catalogue ne correspond à ce filtre.", "Keine Kataloge entsprechen diesem Filter.", "Nenhum catálogo corresponde a este filtro.", "没有目录匹配此筛选器。", "このフィルターに一致するカタログはありません。", "이 필터와 일치하는 카탈로그가 없습니다.", "कोई कैटलॉग इस फ़िल्टर से मेल नहीं खाता।", "لا توجد كتالوجات تطابق هذا المرشح."],
  ["Loading labour libraries...", "Cargando bibliotecas de mano de obra...", "Chargement des bibliothèques de main-d’œuvre...", "Arbeitseinheitenbibliotheken werden geladen...", "Carregando bibliotecas de mão de obra...", "正在加载人工库...", "労務ライブラリを読み込み中...", "노무 라이브러리 로드 중...", "श्रम लाइब्रेरी लोड हो रही हैं...", "جارٍ تحميل مكتبات العمالة..."],
  ["No labour unit libraries available.", "No hay bibliotecas de unidades de mano de obra disponibles.", "Aucune bibliothèque d’unités de main-d’œuvre disponible.", "Keine Arbeitseinheitenbibliotheken verfügbar.", "Nenhuma biblioteca de unidades de mão de obra disponível.", "没有可用的人工单位库。", "利用可能な労務単位ライブラリはありません。", "사용 가능한 노무 단위 라이브러리가 없습니다.", "कोई श्रम इकाई लाइब्रेरी उपलब्ध नहीं।", "لا توجد مكتبات وحدات عمالة متاحة."],
  ["No libraries match this filter.", "Ninguna biblioteca coincide con este filtro.", "Aucune bibliothèque ne correspond à ce filtre.", "Keine Bibliotheken entsprechen diesem Filter.", "Nenhuma biblioteca corresponde a este filtro.", "没有库匹配此筛选器。", "このフィルターに一致するライブラリはありません。", "이 필터와 일치하는 라이브러리가 없습니다.", "कोई लाइब्रेरी इस फ़िल्टर से मेल नहीं खाती।", "لا توجد مكتبات تطابق هذا المرشح."],
  ["Organizer", "Organizador", "Organisateur", "Organizer", "Organizador", "组织器", "整理", "정리함", "आयोजक", "المنظم"],
  ["Project Files", "Archivos del proyecto", "Fichiers du projet", "Projektdateien", "Arquivos do projeto", "项目文件", "プロジェクトファイル", "프로젝트 파일", "प्रोजेक्ट फ़ाइलें", "ملفات المشروع"],
  ["Construction estimating", "Estimación de construcción", "Estimation de construction", "Baukalkulation", "Estimativa de construção", "施工估算", "建設見積", "건설 견적", "निर्माण अनुमान", "تقدير البناء"],
  ["Click a file to view.", "Haz clic en un archivo para verlo.", "Cliquez sur un fichier pour l’afficher.", "Klicken Sie auf eine Datei zur Ansicht.", "Clique em um arquivo para visualizar.", "点击文件查看。", "ファイルをクリックして表示。", "파일을 클릭해 보세요.", "देखने के लिए फ़ाइल क्लिक करें।", "انقر ملفًا لعرضه."],
  ["Contribution", "Contribución", "Contribution", "Beitrag", "Contribuição", "贡献", "寄与", "기여", "योगदान", "المساهمة"],
  ["Ranked by direct cost", "Ordenado por costo directo", "Classé par coût direct", "Nach Direktkosten sortiert", "Classificado por custo direto", "按直接成本排序", "直接原価順", "직접 비용순", "प्रत्यक्ष लागत के अनुसार क्रमबद्ध", "مرتبة حسب التكلفة المباشرة"],
  ["No Cost Basis", "Sin base de costo", "Aucune base de coût", "Keine Kostenbasis", "Sem base de custo", "无成本依据", "原価根拠なし", "원가 기준 없음", "कोई लागत आधार नहीं", "لا يوجد أساس تكلفة"],
  ["Cost Basis", "Base de costo", "Base de coût", "Kostenbasis", "Base de custo", "成本依据", "原価根拠", "원가 기준", "लागत आधार", "أساس التكلفة"],
  ["Margin drag", "Arrastre de margen", "Frein sur la marge", "Margenbelastung", "Arrasto de margem", "利润率拖累", "マージン低下要因", "마진 저하", "मार्जिन दबाव", "ضغط الهامش"],
  ["Margin Drag", "Arrastre de margen", "Frein sur la marge", "Margenbelastung", "Arrasto de margem", "利润率拖累", "マージン低下要因", "마진 저하", "मार्जिन दबाव", "ضغط الهامش"],
  ["None flagged", "Ninguno marcado", "Aucun signalé", "Keine markiert", "Nenhum sinalizado", "未标记", "指摘なし", "표시 없음", "कुछ भी चिह्नित नहीं", "لا شيء محدد"],
  ["Loss", "Pérdida", "Perte", "Verlust", "Perda", "亏损", "損失", "손실", "हानि", "خسارة"],
  ["Concentrated", "Concentrado", "Concentré", "Konzentriert", "Concentrado", "集中", "集中", "집중됨", "केंद्रित", "مركز"],
  ["Accretive", "Acrecitivo", "Relutif", "Wertsteigernd", "Agregador", "增益", "増益", "증가 효과", "मूल्य-वर्धक", "مضيف للقيمة"],
  ["In Range", "En rango", "Dans la plage", "Im Bereich", "Dentro do intervalo", "在范围内", "範囲内", "범위 내", "सीमा में", "ضمن النطاق"],
  ["Cost concentration", "Concentración de costos", "Concentration des coûts", "Kostenkonzentration", "Concentração de custos", "成本集中度", "コスト集中", "비용 집중", "लागत एकाग्रता", "تركز التكلفة"],
  ["Profit driver", "Impulsor de utilidad", "Moteur de profit", "Gewinntreiber", "Driver de lucro", "利润驱动项", "利益ドライバー", "이익 동인", "लाभ चालक", "محرك الربح"],
  ["Largest avg line", "Mayor línea promedio", "Ligne moyenne la plus élevée", "Größte Durchschnittsposition", "Maior linha média", "最大平均行", "最大平均行", "가장 큰 평균 라인", "सबसे बड़ी औसत लाइन", "أكبر متوسط بند"],
  ["Gantt", "Gantt", "Gantt", "Gantt", "Gantt", "甘特图", "ガント", "간트", "गैंट", "جانت"],
  ["Board", "Tablero", "Tableau", "Board", "Quadro", "看板", "ボード", "보드", "बोर्ड", "لوحة"],
  ["Late", "Atrasado", "En retard", "Verspätet", "Atrasado", "逾期", "遅延", "지연", "देर", "متأخر"],
  ["Slip", "Deslizamiento", "Glissement", "Verzug", "Desvio", "滑移", "ずれ", "밀림", "फिसलन", "انزلاق"],
  ["Issues", "Incidencias", "Problèmes", "Probleme", "Problemas", "问题", "課題", "이슈", "समस्याएँ", "المشكلات"],
  ["TBD", "Por definir", "À définir", "Noch offen", "A definir", "待定", "未定", "미정", "निर्धारित होना है", "يحدد لاحقًا"],
  ["Primary", "Principal", "Principal", "Primär", "Principal", "主要", "プライマリ", "기본", "प्राथमिक", "أساسي"],
  ["Scroll earlier", "Desplazar antes", "Faire défiler plus tôt", "Früher scrollen", "Rolar para antes", "向前滚动", "前へスクロール", "이전으로 스크롤", "पहले की ओर स्क्रॉल करें", "التمرير إلى وقت سابق"],
  ["Jump to today", "Ir a hoy", "Aller à aujourd’hui", "Zu heute springen", "Ir para hoje", "跳到今天", "今日へ移動", "오늘로 이동", "आज पर जाएँ", "الانتقال إلى اليوم"],
  ["Scroll later", "Desplazar después", "Faire défiler plus tard", "Später scrollen", "Rolar para depois", "向后滚动", "後へスクロール", "나중으로 스크롤", "बाद की ओर स्क्रॉल करें", "التمرير إلى وقت لاحق"],
  ["Zoom out", "Alejar", "Zoom arrière", "Verkleinern", "Reduzir zoom", "缩小", "ズームアウト", "축소", "ज़ूम आउट", "تصغير"],
  ["Zoom in", "Acercar", "Zoom avant", "Vergrößern", "Ampliar zoom", "放大", "ズームイン", "확대", "ज़ूम इन", "تكبير"],
  ["Zoom day", "Zoom día", "Zoom jour", "Zoom Tag", "Zoom dia", "缩放到天", "日表示", "일 단위 줌", "दिन ज़ूम", "تكبير اليوم"],
  ["Zoom week", "Zoom semana", "Zoom semaine", "Zoom Woche", "Zoom semana", "缩放到周", "週表示", "주 단위 줌", "सप्ताह ज़ूम", "تكبير الأسبوع"],
  ["Zoom month", "Zoom mes", "Zoom mois", "Zoom Monat", "Zoom mês", "缩放到月", "月表示", "월 단위 줌", "महीना ज़ूम", "تكبير الشهر"],
  ["List Mode", "Modo lista", "Mode liste", "Listenmodus", "Modo lista", "列表模式", "リストモード", "목록 모드", "सूची मोड", "وضع القائمة"],
  ["Board Mode", "Modo tablero", "Mode tableau", "Boardmodus", "Modo quadro", "看板模式", "ボードモード", "보드 모드", "बोर्ड मोड", "وضع اللوحة"],
  ["Task", "Tarea", "Tâche", "Aufgabe", "Tarefa", "任务", "タスク", "작업", "कार्य", "مهمة"],
  ["Add task", "Agregar tarea", "Ajouter une tâche", "Aufgabe hinzufügen", "Adicionar tarefa", "添加任务", "タスクを追加", "작업 추가", "कार्य जोड़ें", "إضافة مهمة"],
  ["Toggle filters", "Alternar filtros", "Activer/désactiver les filtres", "Filter umschalten", "Alternar filtros", "切换筛选器", "フィルター切替", "필터 전환", "फ़िल्टर टॉगल करें", "تبديل المرشحات"],
  ["Toggle critical path", "Alternar ruta crítica", "Activer/désactiver le chemin critique", "Kritischen Pfad umschalten", "Alternar caminho crítico", "切换关键路径", "クリティカルパス切替", "주공정 전환", "क्रिटिकल पाथ टॉगल करें", "تبديل المسار الحرج"],
  ["Path", "Ruta", "Chemin", "Pfad", "Caminho", "路径", "パス", "경로", "पथ", "المسار"],
  ["Hide baseline", "Ocultar línea base", "Masquer la référence", "Basisplan ausblenden", "Ocultar linha de base", "隐藏基线", "ベースラインを非表示", "기준선 숨기기", "बेसलाइन छिपाएँ", "إخفاء خط الأساس"],
  ["Show baseline", "Mostrar línea base", "Afficher la référence", "Basisplan anzeigen", "Mostrar linha de base", "显示基线", "ベースラインを表示", "기준선 표시", "बेसलाइन दिखाएँ", "إظهار خط الأساس"],
  ["Schedule health filter", "Filtro de salud del programa", "Filtre de santé du calendrier", "Terminplan-Gesundheitsfilter", "Filtro de saúde do cronograma", "计划健康筛选器", "スケジュール健全性フィルター", "일정 상태 필터", "शेड्यूल स्वास्थ्य फ़िल्टर", "مرشح صحة الجدول"],
  ["deadline miss", "incumplimiento de plazo", "échéance manquée", "Terminverfehlung", "perda de prazo", "错过截止日期", "期限未達", "마감 미스", "समयसीमा चूक", "تأخر عن الموعد"],
  ["deadline misses", "incumplimientos de plazo", "échéances manquées", "Terminverfehlungen", "perdas de prazo", "错过截止日期", "期限未達", "마감 미스", "समयसीमा चूक", "تأخرات عن المواعيد"],
  ["resource conflict", "conflicto de recursos", "conflit de ressources", "Ressourcenkonflikt", "conflito de recursos", "资源冲突", "リソース競合", "리소스 충돌", "संसाधन संघर्ष", "تعارض موارد"],
  ["resource conflicts", "conflictos de recursos", "conflits de ressources", "Ressourcenkonflikte", "conflitos de recursos", "资源冲突", "リソース競合", "리소스 충돌", "संसाधन संघर्ष", "تعارضات موارد"],
  ["constraint violation", "violación de restricción", "violation de contrainte", "Einschränkungsverstoß", "violação de restrição", "约束违规", "制約違反", "제약 위반", "बाधा उल्लंघन", "مخالفة قيد"],
  ["constraint violations", "violaciones de restricción", "violations de contrainte", "Einschränkungsverstöße", "violações de restrição", "约束违规", "制約違反", "제약 위반", "बाधा उल्लंघन", "مخالفات قيود"],
  ["Baseline controls. Active:", "Controles de línea base. Activo:", "Contrôles de référence. Actif :", "Basisplansteuerung. Aktiv:", "Controles da linha de base. Ativo:", "基线控件。活动：", "ベースライン操作。アクティブ:", "기준선 제어. 활성:", "बेसलाइन नियंत्रण। सक्रिय:", "عناصر تحكم خط الأساس. نشط:"],
  ["Baseline", "Línea base", "Référence", "Basisplan", "Linha de base", "基线", "ベースライン", "기준선", "बेसलाइन", "خط الأساس"],
  ["Active:", "Activo:", "Actif :", "Aktiv:", "Ativo:", "活动：", "アクティブ:", "활성:", "सक्रिय:", "نشط:"],
  ["No Baseline", "Sin línea base", "Aucune référence", "Kein Basisplan", "Sem linha de base", "无基线", "ベースラインなし", "기준선 없음", "कोई बेसलाइन नहीं", "لا يوجد خط أساس"],
  ["Clear", "Borrar", "Effacer", "Löschen", "Limpar", "清除", "クリア", "지우기", "साफ़ करें", "مسح"],
  ["Hide", "Ocultar", "Masquer", "Ausblenden", "Ocultar", "隐藏", "非表示", "숨기기", "छिपाएँ", "إخفاء"],
  ["Control", "Control", "Contrôle", "Steuerung", "Controle", "控制", "制御", "제어", "नियंत्रण", "التحكم"],
  ["Manage schedule calendars, resources, and baselines", "Administrar calendarios, recursos y líneas base del programa", "Gérer les calendriers, ressources et références du calendrier", "Terminplankalender, Ressourcen und Basispläne verwalten", "Gerenciar calendários, recursos e linhas de base do cronograma", "管理计划日历、资源和基线", "スケジュールカレンダー、リソース、ベースラインを管理", "일정 캘린더, 리소스 및 기준선 관리", "शेड्यूल कैलेंडर, संसाधन और बेसलाइन प्रबंधित करें", "إدارة تقاويم الجدول والموارد وخطوط الأساس"],
  ["Variance", "Varianza", "Écart", "Abweichung", "Variação", "偏差", "差異", "편차", "विचलन", "التباين"],
  ["Float", "Holgura", "Marge libre", "Puffer", "Folga", "浮动时间", "余裕", "여유", "फ्लोट", "المرونة"],
  ["Progress", "Progreso", "Avancement", "Fortschritt", "Progresso", "进度", "進捗", "진행률", "प्रगति", "التقدم"],
  ["Assignee", "Responsable", "Responsable", "Zuständige Person", "Responsável", "负责人", "担当者", "담당자", "असाइनी", "المسؤول"],
  ["Summary", "Resumen", "Résumé", "Zusammenfassung", "Resumo", "摘要", "サマリー", "요약", "सारांश", "الملخص"],
  ["Overdue", "Vencido", "En retard", "Überfällig", "Atrasado", "逾期", "期限超過", "연체", "अतिदेय", "متأخر"],
  ["Logic", "Lógica", "Logique", "Logik", "Lógica", "逻辑", "ロジック", "논리", "तर्क", "المنطق"],
  ["Open End", "Fin abierta", "Fin ouverte", "Offenes Ende", "Fim aberto", "开放结束", "未接続終了", "열린 종료", "खुला अंत", "نهاية مفتوحة"],
  ["Deadline", "Plazo", "Échéance", "Termin", "Prazo", "截止日期", "期限", "마감일", "समयसीमा", "الموعد النهائي"],
  ["Constraint", "Restricción", "Contrainte", "Einschränkung", "Restrição", "约束", "制約", "제약", "बाधा", "القيد"],
  ["Actuals", "Datos reales", "Réels", "Ist-Werte", "Reais", "实际值", "実績", "실적", "वास्तविक", "الفعليات"],
  ["Not Started", "No iniciado", "Non démarré", "Nicht gestartet", "Não iniciado", "未开始", "未開始", "시작 전", "शुरू नहीं", "لم يبدأ"],
  ["In Progress", "En curso", "En cours", "In Arbeit", "Em andamento", "进行中", "進行中", "진행 중", "प्रगति में", "قيد التنفيذ"],
  ["On Hold", "En pausa", "En attente", "Angehalten", "Em espera", "暂停", "保留中", "보류", "होल्ड पर", "قيد الانتظار"],
  ["Excellent", "Excelente", "Excellent", "Ausgezeichnet", "Excelente", "优秀", "優秀", "우수", "उत्कृष्ट", "ممتاز"],
  ["Good", "Bueno", "Bon", "Gut", "Bom", "良好", "良好", "좋음", "अच्छा", "جيد"],
  ["Needs review", "Requiere revisión", "À réviser", "Prüfung nötig", "Precisa de revisão", "需要审核", "要確認", "검토 필요", "समीक्षा आवश्यक", "بحاجة إلى مراجعة"],
  ["Needs work", "Necesita trabajo", "Nécessite du travail", "Nacharbeit nötig", "Precisa de ajustes", "需要处理", "要対応", "작업 필요", "काम आवश्यक", "بحاجة إلى عمل"],
  ["Pass", "Aprobado", "Réussi", "Bestanden", "Aprovado", "通过", "合格", "통과", "पास", "ناجح"],
  ["No validation findings yet.", "Aún no hay hallazgos de validación.", "Aucune constatation de validation pour l’instant.", "Noch keine Validierungsbefunde.", "Ainda não há apontamentos de validação.", "还没有验证发现。", "検証所見はまだありません。", "아직 검증 발견 사항이 없습니다.", "अभी कोई सत्यापन निष्कर्ष नहीं।", "لا توجد ملاحظات تحقق بعد."],
  ["Reviewed", "Revisado", "Révisé", "Geprüft", "Revisado", "已审核", "レビュー済み", "검토됨", "समीक्षित", "تمت المراجعة"],
  ["Quote", "Cotización", "Devis", "Angebot", "Cotação", "报价", "見積", "견적", "कोटेशन", "العرض"],
  ["Added", "Agregado", "Ajouté", "Hinzugefügt", "Adicionado", "已添加", "追加済み", "추가됨", "जोड़ा गया", "تمت الإضافة"],
  ["Updated", "Actualizado", "Mis à jour", "Aktualisiert", "Atualizado", "已更新", "更新済み", "업데이트됨", "अपडेट किया गया", "تم التحديث"],
  ["Removed", "Eliminado", "Supprimé", "Entfernt", "Removido", "已移除", "削除済み", "제거됨", "हटाया गया", "تمت الإزالة"],
  ["Created", "Creado", "Créé", "Erstellt", "Criado", "已创建", "作成済み", "생성됨", "बनाया गया", "تم الإنشاء"],
  ["Deleted", "Eliminado", "Supprimé", "Gelöscht", "Excluído", "已删除", "削除済み", "삭제됨", "हटाया गया", "تم الحذف"],
  ["Sent", "Enviado", "Envoyé", "Gesendet", "Enviado", "已发送", "送信済み", "전송됨", "भेजा गया", "تم الإرسال"],
  ["Accepted", "Aceptado", "Accepté", "Übernommen", "Aceito", "已接受", "承認済み", "수락됨", "स्वीकार किया गया", "تم القبول"],
  ["Reverted", "Revertido", "Annulé", "Zurückgesetzt", "Revertido", "已还原", "元に戻しました", "되돌림", "वापस किया गया", "تم التراجع"],
  ["Revert", "Revertir", "Rétablir", "Zurücksetzen", "Reverter", "还原", "元に戻す", "되돌리기", "वापस करें", "تراجع"],
  ["Reverted:", "Revertido:", "Annulé :", "Zurückgesetzt:", "Revertido:", "已还原：", "元に戻しました:", "되돌림:", "वापस किया गया:", "تم التراجع:"],
  ["Revision", "Revisión", "Révision", "Revision", "Revisão", "修订", "リビジョン", "개정", "संशोधन", "المراجعة"],
  ["Schedule", "Programa", "Calendrier", "Terminplan", "Cronograma", "计划", "スケジュール", "일정", "शेड्यूल", "الجدول"],
  ["All actions", "Todas las acciones", "Toutes les actions", "Alle Aktionen", "Todas as ações", "所有操作", "すべてのアクション", "모든 작업", "सभी कार्रवाइयाँ", "كل الإجراءات"],
  ["just now", "ahora mismo", "à l’instant", "gerade eben", "agora mesmo", "刚刚", "たった今", "방금", "अभी-अभी", "الآن"],
  ["ago", "hace", "il y a", "vor", "atrás", "前", "前", "전", "पहले", "منذ"],
  ["field", "campo", "champ", "Feld", "campo", "字段", "フィールド", "필드", "फ़ील्ड", "حقل"],
  ["fields", "campos", "champs", "Felder", "campos", "字段", "フィールド", "필드", "फ़ील्ड", "حقول"],
  ["tool call", "llamada de herramienta", "appel d’outil", "Werkzeugaufruf", "chamada de ferramenta", "工具调用", "ツール呼び出し", "도구 호출", "टूल कॉल", "استدعاء أداة"],
  ["tool calls", "llamadas de herramienta", "appels d’outil", "Werkzeugaufrufe", "chamadas de ferramenta", "工具调用", "ツール呼び出し", "도구 호출", "टूल कॉल", "استدعاءات أدوات"],
  ["AI conversation", "Conversación de IA", "Conversation IA", "KI-Unterhaltung", "Conversa de IA", "AI 对话", "AI会話", "AI 대화", "AI वार्तालाप", "محادثة ذكاء اصطناعي"],
  ["AI-generated phases", "fases generadas por IA", "phases générées par IA", "KI-generierte Phasen", "fases geradas por IA", "AI 生成阶段", "AI生成フェーズ", "AI 생성 단계", "AI-जनित चरण", "مراحل مولدة بالذكاء الاصطناعي"],
  ["AI-generated items", "elementos generados por IA", "articles générés par IA", "KI-generierte Elemente", "itens gerados por IA", "AI 生成项目", "AI生成項目", "AI 생성 항목", "AI-जनित आइटम", "بنود مولدة بالذكاء الاصطناعي"],
  ["Sent quote", "Cotización enviada", "Devis envoyé", "Angebot gesendet", "Cotação enviada", "报价已发送", "見積を送信しました", "견적 전송됨", "कोटेशन भेजा गया", "تم إرسال العرض"],
  ["Updated revision settings", "Configuración de revisión actualizada", "Paramètres de révision mis à jour", "Revisionseinstellungen aktualisiert", "Configurações de revisão atualizadas", "修订设置已更新", "リビジョン設定を更新", "개정 설정 업데이트됨", "संशोधन सेटिंग अपडेट हुई", "تم تحديث إعدادات المراجعة"],
  ["Updated quote details", "Detalles de cotización actualizados", "Détails du devis mis à jour", "Angebotsdetails aktualisiert", "Detalhes da cotação atualizados", "报价详情已更新", "見積詳細を更新", "견적 세부 정보 업데이트됨", "कोटेशन विवरण अपडेट हुआ", "تم تحديث تفاصيل العرض"]
];

const TRANSLATIONS = Object.fromEntries(
  LOCALES.map((locale, localeIndex) => [
    locale,
    Object.fromEntries(ENTRIES.map(([english, ...values]) => [english, values[localeIndex] ?? english])),
  ]),
) as Record<NonEnglishLocale, Record<string, string>>;

function termKey(value: string) {
  return value
    .replace(/&rsquo;/g, "'")
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isComposableTerm(value: string) {
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= 48 &&
    !/[.!?]/.test(trimmed.replace(/\.\.\.$/, "")) &&
    /^[A-Za-z0-9][A-Za-z0-9 '&()+,\-/:#%×.]*$/.test(trimmed)
  );
}

const TERM_TRANSLATIONS = Object.fromEntries(
  LOCALES.map((locale, localeIndex) => [
    locale,
    Object.fromEntries(
      ENTRIES
        .filter(([english]) => isComposableTerm(english))
        .map(([english, ...values]) => [termKey(english), values[localeIndex] ?? english]),
    ),
  ]),
) as Record<NonEnglishLocale, Record<string, string>>;

function translateTerm(locale: NonEnglishLocale, value: string) {
  return TERM_TRANSLATIONS[locale][termKey(value)] ?? value;
}

function translateCountTerm(locale: NonEnglishLocale, count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${translateTerm(locale, count === 1 ? singular : plural)}`;
}

function translateAgo(locale: NonEnglishLocale, value: string) {
  const ago = translateTerm(locale, "ago");
  if (locale === "es" || locale === "fr-CA" || locale === "de" || locale === "ar") return `${ago} ${value}`;
  return `${value} ${ago}`;
}

const PRESERVED_WORDS = new Set([
  "2D",
  "3D",
  "AI",
  "API",
  "ASTM",
  "BIM",
  "BOM",
  "CAD",
  "CSI",
  "CSV",
  "CV",
  "DIN",
  "DWG",
  "DXF",
  "ICMS",
  "JSON",
  "NRM",
  "OCR",
  "PDF",
  "PDFS",
  "U1",
  "U2",
  "U3",
  "XLS",
  "XLSX",
]);

function isWordToken(value: string) {
  return /^(?:[A-Za-z][A-Za-z0-9]*(?:['’][A-Za-z0-9]+)?|\d+[A-Za-z][A-Za-z0-9]*)$/.test(value);
}

function translateSingleWord(terms: Record<string, string>, token: string) {
  const direct = terms[termKey(token)];
  if (direct) return direct;

  const title = token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
  const titled = terms[termKey(title)];
  if (titled) return titled;

  const upper = token.toUpperCase();
  if (PRESERVED_WORDS.has(upper) || /^[A-Z]{2,}\d*$/.test(token)) return token;

  if (token.endsWith("s")) {
    const singular = terms[termKey(token.slice(0, -1))];
    if (singular) return singular;
  }

  return null;
}

function translateComposedPhrase(locale: NonEnglishLocale, value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 90) return null;
  if (/[{}[\]|<>]/.test(trimmed)) return null;
  if (/https?:|\/api\/|^\//i.test(trimmed)) return null;
  if (/[.!?]/.test(trimmed.replace(/\.\.\.$/, "").replace(/…$/, "").replace(/\b(?:Ext|Conf)\./g, ""))) return null;

  const tokens = trimmed.match(/\d+[A-Za-z][A-Za-z0-9]*|[A-Za-z][A-Za-z0-9]*(?:['’][A-Za-z0-9]+)?|\d+(?:\.\d+)?|[^A-Za-z0-9]+/g);
  if (!tokens) return null;

  const wordCount = tokens.filter(isWordToken).length;
  if (wordCount === 0 || wordCount > 8) return null;

  const terms = TERM_TRANSLATIONS[locale];
  let translatedWords = 0;
  let output = "";

  for (let index = 0; index < tokens.length;) {
    const token = tokens[index] ?? "";
    if (!isWordToken(token)) {
      output += token;
      index += 1;
      continue;
    }

    let consumed = 0;
    let translated: string | null = null;
    for (let words = Math.min(4, wordCount); words >= 2; words -= 1) {
      const phraseTokens: string[] = [];
      let cursor = index;
      let seenWords = 0;
      while (cursor < tokens.length && seenWords < words) {
        const current = tokens[cursor] ?? "";
        if (isWordToken(current)) {
          phraseTokens.push(current);
          seenWords += 1;
          cursor += 1;
          continue;
        }
        if (/^\s+$/.test(current)) {
          phraseTokens.push(" ");
          cursor += 1;
          continue;
        }
        break;
      }

      if (seenWords === words) {
        const candidate = terms[termKey(phraseTokens.join(""))];
        if (candidate) {
          consumed = cursor - index;
          translated = candidate;
          break;
        }
      }
    }

    if (!translated) {
      translated = translateSingleWord(terms, token);
      consumed = 1;
    }

    if (!translated) return null;
    if (translated !== token) translatedWords += 1;
    output += translated;
    index += consumed;
  }

  return translatedWords > 0 ? output : null;
}

const TERMS: Record<NonEnglishLocale, {
  due: string;
  margin: (value: string) => string;
  rev: string;
  savedRevision: (count: number) => string;
  phaseCount: (count: number) => string;
  topLevel: string;
  rowCount: (count: number) => string;
  lineCount: (count: number) => string;
  visible: string;
}> = {
  es: {
    due: "Vence",
    margin: (value) => `${value} margen`,
    rev: "Rev.",
    savedRevision: (count) => `${count} ${count === 1 ? "revisión guardada" : "revisiones guardadas"}`,
    phaseCount: (count) => `${count} ${count === 1 ? "fase" : "fases"}`,
    topLevel: "nivel superior",
    rowCount: (count) => `${count} ${count === 1 ? "fila" : "filas"}`,
    lineCount: (count) => `${count} ${count === 1 ? "línea" : "líneas"}`,
    visible: "visibles",
  },
  "fr-CA": {
    due: "Échéance",
    margin: (value) => `${value} marge`,
    rev: "Rév.",
    savedRevision: (count) => `${count} ${count === 1 ? "révision enregistrée" : "révisions enregistrées"}`,
    phaseCount: (count) => `${count} ${count === 1 ? "phase" : "phases"}`,
    topLevel: "niveau supérieur",
    rowCount: (count) => `${count} ${count === 1 ? "ligne" : "lignes"}`,
    lineCount: (count) => `${count} ${count === 1 ? "ligne" : "lignes"}`,
    visible: "visibles",
  },
  de: {
    due: "Fällig",
    margin: (value) => `${value} Marge`,
    rev: "Rev.",
    savedRevision: (count) => `${count} gespeicherte ${count === 1 ? "Revision" : "Revisionen"}`,
    phaseCount: (count) => `${count} ${count === 1 ? "Phase" : "Phasen"}`,
    topLevel: "oberste Ebene",
    rowCount: (count) => `${count} ${count === 1 ? "Zeile" : "Zeilen"}`,
    lineCount: (count) => `${count} ${count === 1 ? "Zeile" : "Zeilen"}`,
    visible: "sichtbar",
  },
  "pt-BR": {
    due: "Vence",
    margin: (value) => `${value} margem`,
    rev: "Rev.",
    savedRevision: (count) => `${count} ${count === 1 ? "revisão salva" : "revisões salvas"}`,
    phaseCount: (count) => `${count} ${count === 1 ? "fase" : "fases"}`,
    topLevel: "nível superior",
    rowCount: (count) => `${count} ${count === 1 ? "linha" : "linhas"}`,
    lineCount: (count) => `${count} ${count === 1 ? "linha" : "linhas"}`,
    visible: "visíveis",
  },
  "zh-CN": {
    due: "截止",
    margin: (value) => `${value} 利润率`,
    rev: "修订",
    savedRevision: (count) => `${count} 个已保存修订`,
    phaseCount: (count) => `${count} 个阶段`,
    topLevel: "顶级",
    rowCount: (count) => `${count} 行`,
    lineCount: (count) => `${count} 行`,
    visible: "可见",
  },
  ja: {
    due: "期限",
    margin: (value) => `${value} マージン`,
    rev: "Rev",
    savedRevision: (count) => `${count} 件の保存済みリビジョン`,
    phaseCount: (count) => `${count} フェーズ`,
    topLevel: "最上位",
    rowCount: (count) => `${count} 行`,
    lineCount: (count) => `${count} 行`,
    visible: "表示",
  },
  ko: {
    due: "마감",
    margin: (value) => `${value} 마진`,
    rev: "개정",
    savedRevision: (count) => `${count}개의 저장된 개정`,
    phaseCount: (count) => `${count}개 단계`,
    topLevel: "최상위",
    rowCount: (count) => `${count}개 행`,
    lineCount: (count) => `${count}개 라인`,
    visible: "표시",
  },
  hi: {
    due: "देय",
    margin: (value) => `${value} मार्जिन`,
    rev: "संशोधन",
    savedRevision: (count) => `${count} सहेजे गए संशोधन`,
    phaseCount: (count) => `${count} चरण`,
    topLevel: "शीर्ष स्तर",
    rowCount: (count) => `${count} पंक्तियाँ`,
    lineCount: (count) => `${count} लाइनें`,
    visible: "दृश्यमान",
  },
  ar: {
    due: "مستحق",
    margin: (value) => `هامش ${value}`,
    rev: "مراجعة",
    savedRevision: (count) => `${count} ${count === 1 ? "مراجعة محفوظة" : "مراجعات محفوظة"}`,
    phaseCount: (count) => `${count} ${count === 1 ? "مرحلة" : "مراحل"}`,
    topLevel: "مستوى أعلى",
    rowCount: (count) => `${count} ${count === 1 ? "صف" : "صفوف"}`,
    lineCount: (count) => `${count} ${count === 1 ? "سطر" : "سطور"}`,
    visible: "مرئية",
  },
};

function translateDynamic(locale: NonEnglishLocale, value: string) {
  const terms = TERMS[locale];
  let match = /^Due (.+)$/.exec(value);
  if (match) return `${terms.due} ${match[1]}`;

  match = /^Rev (\d+)$/.exec(value);
  if (match) return `${terms.rev} ${match[1]}`;

  match = /^(\d+) saved revisions?$/.exec(value);
  if (match) return terms.savedRevision(Number(match[1]));

  match = /^(\d+) phases?$/.exec(value);
  if (match) return terms.phaseCount(Number(match[1]));

  match = /^(\d+) top level$/.exec(value);
  if (match) return `${match[1]} ${terms.topLevel}`;

  match = /^(\d+) rows?$/.exec(value);
  if (match) return terms.rowCount(Number(match[1]));

  match = /^(\d+) lines?$/.exec(value);
  if (match) return terms.lineCount(Number(match[1]));

  match = /^(\d+)\/(\d+) visible$/.exec(value);
  if (match) return `${match[1]}/${match[2]} ${terms.visible}`;

  match = /^(\d+)\/(\d+) enabled$/.exec(value);
  if (match) return `${match[1]}/${match[2]} ${translateTerm(locale, "enabled")}`;

  match = /^(\d+)\/(\d+) source types on$/.exec(value);
  if (match) return `${match[1]}/${match[2]} ${translateTerm(locale, "source types on")}`;

  match = /^(\d+) tasks?$/.exec(value);
  if (match) return translateCountTerm(locale, Number(match[1]), "task", "tasks");

  match = /^(\d+) items?$/.exec(value);
  if (match) return translateCountTerm(locale, Number(match[1]), "Item", "Items");

  match = /^(\d+) units?$/.exec(value);
  if (match) return translateCountTerm(locale, Number(match[1]), "unit", "units");

  match = /^(\d+) fields?$/.exec(value);
  if (match) return translateCountTerm(locale, Number(match[1]), "field", "fields");

  match = /^(\d+) tool calls?$/.exec(value);
  if (match) return translateCountTerm(locale, Number(match[1]), "tool call", "tool calls");

  match = /^(\d+) deadline misses?$/.exec(value);
  if (match) return translateCountTerm(locale, Number(match[1]), "deadline miss", "deadline misses");

  match = /^(\d+) resource conflicts?$/.exec(value);
  if (match) return translateCountTerm(locale, Number(match[1]), "resource conflict", "resource conflicts");

  match = /^(\d+) constraint violations?$/.exec(value);
  if (match) return translateCountTerm(locale, Number(match[1]), "constraint violation", "constraint violations");

  match = /^(\d+[mhd]) ago$/.exec(value);
  if (match) return translateAgo(locale, match[1]);

  match = /^Reviewed (.+)$/.exec(value);
  if (match) return `${translateTerm(locale, "Reviewed")} ${match[1]}`;

  match = /^Quote (.+)$/.exec(value);
  if (match) return `${translateTerm(locale, "Quote")} ${match[1]}`;

  match = /^Baseline controls\. Active: (.+)$/.exec(value);
  if (match) return `${translateTerm(locale, "Baseline controls. Active:")} ${match[1]}`;

  match = /^(.+) margin$/.exec(value);
  if (match) return terms.margin(match[1]);

  return null;
}

function translate(locale: SupportedLocale, value: string) {
  if (locale === DEFAULT_LOCALE) return value;
  const dictionary = TRANSLATIONS[locale as NonEnglishLocale];
  if (!dictionary) return value;

  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const trimmed = value.trim();
  if (!trimmed) return value;

  const activeLocale = locale as NonEnglishLocale;
  const translated = dictionary[trimmed] ?? translateDynamic(activeLocale, trimmed) ?? translateComposedPhrase(activeLocale, trimmed);
  return translated ? `${leading}${translated}${trailing}` : value;
}

function isKnownLocalizedVariant(original: string, current: string) {
  return current === original || LOCALES.some((locale) => translate(locale, original) === current);
}

function shouldSkipElement(element: Element | null) {
  if (!element) return true;
  return Boolean(element.closest("script, style, code, pre, textarea, [data-workspace-i18n-skip]"));
}

function originalAttrName(attribute: string) {
  return `data-workspace-i18n-original-${attribute.replace(/[^a-z0-9-]/gi, "-")}`;
}

export function WorkspaceI18nSurface({ children }: { children: ReactNode }) {
  const locale = normalizeLocale(useLocale());
  const originals = useRef<WeakMap<Text, string>>(new WeakMap());

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.body;

    function localizeAttributes(element: Element) {
      if (shouldSkipElement(element)) return;
      for (const attribute of ["placeholder", "title", "aria-label"]) {
        const current = element.getAttribute(attribute);
        if (!current) continue;
        const originalAttribute = originalAttrName(attribute);
        const storedOriginal = element.getAttribute(originalAttribute);
        const original = storedOriginal && isKnownLocalizedVariant(storedOriginal, current) ? storedOriginal : current;
        const next = translate(locale, original);
        if (next !== original) {
          if (storedOriginal !== original) element.setAttribute(originalAttribute, original);
          if (current !== next) element.setAttribute(attribute, next);
        } else if (element.hasAttribute(originalAttribute) && current !== original) {
          element.setAttribute(attribute, original);
        }
      }
    }

    function localizeTextNode(node: Text) {
      const parent = node.parentElement;
      if (shouldSkipElement(parent)) return;
      const storedOriginal = originals.current.get(node);
      const original = storedOriginal && isKnownLocalizedVariant(storedOriginal, node.data) ? storedOriginal : node.data;
      const next = translate(locale, original);
      if (next !== original) originals.current.set(node, original);
      if (node.data !== next) node.data = next;
    }

    function localizeTree(start: ParentNode) {
      if (start instanceof Element) {
        localizeAttributes(start);
        start.querySelectorAll("*").forEach(localizeAttributes);
      }

      const walker = document.createTreeWalker(start, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        localizeTextNode(node as Text);
        node = walker.nextNode();
      }
    }

    localizeTree(root);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData" && mutation.target instanceof Text) {
          localizeTextNode(mutation.target);
        }
        if (mutation.type === "attributes" && mutation.target instanceof Element) {
          localizeAttributes(mutation.target);
        }
        for (const node of Array.from(mutation.addedNodes)) {
          if (node instanceof Text) localizeTextNode(node);
          else if (node instanceof Element) localizeTree(node);
        }
      }
    });

    observer.observe(root, {
      attributes: true,
      attributeFilter: ["placeholder", "title", "aria-label"],
      childList: true,
      characterData: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, [locale]);

  return <div data-workspace-i18n-root className="flex h-full min-h-0 flex-1 flex-col">{children}</div>;
}
