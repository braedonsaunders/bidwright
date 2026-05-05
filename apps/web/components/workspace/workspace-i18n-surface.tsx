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
  ["Search line-capable factors", "Buscar factores aplicables a líneas", "Rechercher des facteurs applicables aux lignes", "Zeilenfähige Faktoren suchen", "Buscar fatores aplicáveis a linhas", "搜索可用于行的系数", "行対応係数を検索", "라인 적용 가능 계수 검색", "लाइन-सक्षम कारक खोजें", "البحث عن عوامل مناسبة للبنود"]
];

const TRANSLATIONS = Object.fromEntries(
  LOCALES.map((locale, localeIndex) => [
    locale,
    Object.fromEntries(ENTRIES.map(([english, ...values]) => [english, values[localeIndex] ?? english])),
  ]),
) as Record<NonEnglishLocale, Record<string, string>>;

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

  const translated = dictionary[trimmed] ?? translateDynamic(locale as NonEnglishLocale, trimmed);
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

  return <div data-workspace-i18n-root>{children}</div>;
}
