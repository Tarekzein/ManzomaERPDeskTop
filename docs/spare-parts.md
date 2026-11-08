# Optional spare parts / قطع الغيار الاختيارية

## English

1. Create each spare part as a normal **stock item**. Optionally enter its initial quantity, warehouse, date, and cost when creating it. Batch items need a batch number; serial items need their serial numbers. Initial stock requires the existing stock-adjustment permission.
2. Create or edit the finished product and enable **Automatically consume spare parts when sold**. Select each part and enter its quantity per **one base unit** of the product. For example, enter 5 screws per product.
3. Create a sales invoice directly or convert a confirmed sales order. Selling 2 products previews 10 screws. **Posting the invoice** deducts 2 products and 10 screws from the invoice warehouse. Saving drafts or confirming orders does not deduct stock.
4. Review **Consumed spare parts** on the posted invoice or open the part's item card to see its movements. Customer invoice lines and printouts still show the products being sold. Component costs are included in invoice cost and profit, with costs visible only to authorized users.
5. A linked partial sales return restores the original parts proportionally, even if the recipe was changed or disabled. A full return restores the complete original quantities and costs. Voiding a document reverses its recorded movements. A return without an original invoice restores only the product.

Recipes are optional and have one level. Parts must be active stock items without serial tracking or their own recipes. Batch parts are picked by expiry using the existing stock rules. A shared part can be used by many products; a shortage blocks the entire posting unless existing negative-stock settings permit it. Remove a part from recipes before changing its base unit, tracking mode, stock type, or active status.

Leave initial quantity empty or zero to create an item without stock movements. After creation, enter purchases or use stock documents to change quantities. Disabling a recipe affects future invoices only. Existing invoices are not changed retrospectively.

## العربية

1. أنشئ كل قطعة غيار كصنف مخزني عادي. يمكنك إدخال الكمية الافتتاحية والمخزن والتاريخ والتكلفة عند الإنشاء. أصناف التشغيلات تحتاج إلى رقم التشغيلة، والأصناف المسلسلة تحتاج إلى أرقامها. إدخال الرصيد الافتتاحي يتطلب صلاحية تعديل المخزون الحالية.
2. عند إنشاء المنتج أو تعديله، فعّل **استهلاك قطع الغيار تلقائياً عند البيع**. اختر قطع الغيار وأدخل الكمية اللازمة لكل **وحدة أساسية واحدة** من المنتج؛ مثلاً ٥ مسامير لكل منتج.
3. أنشئ فاتورة بيع مباشرة أو حوّل أمر بيع مؤكداً إلى فاتورة. عند بيع منتجين يظهر احتياج ١٠ مسامير. يتم خصم المنتجين والمسامير من مخزن الفاتورة **عند ترحيل الفاتورة فقط**. حفظ المسودة أو تأكيد أمر البيع لا يخصم المخزون.
4. تعرض الفاتورة المرحلة **قطع الغيار المستهلكة**، وتظهر الحركات أيضاً في كارت صنف قطعة الغيار. تعرض الفاتورة المطبوعة للعميل المنتجات المباعة، بينما تشمل التكلفة والربح تكلفة قطع الغيار حسب صلاحيات المستخدم.
5. يعيد المرتجع المرتبط بالفاتورة الأصلية قطع الغيار بنسبة الكمية المرتجعة، حتى بعد تعديل المكونات أو إيقافها. يعيد المرتجع الكامل الكميات والتكاليف الأصلية بالكامل، ويعكس الإلغاء الحركات الفعلية. المرتجع غير المرتبط بفاتورة أصلية يعيد المنتج فقط.

المكونات اختيارية ومن مستوى واحد. يجب أن تكون قطع الغيار أصنافاً مخزنية نشطة بدون تتبع مسلسل أو مكونات خاصة بها. تُصرف التشغيلات حسب الصلاحية وقواعد المخزون الحالية. يمكن مشاركة قطعة الغيار بين عدة منتجات. نقص أي قطعة يمنع ترحيل الفاتورة بالكامل، إلا إذا سمحت إعدادات وصلاحيات المخزون السالب بذلك. أزل القطعة من المكونات قبل تغيير وحدتها الأساسية أو إعدادات تتبعها أو نوعها أو إيقافها.

اترك الكمية الافتتاحية فارغة أو صفراً لإنشاء الصنف بدون حركة مخزون. بعد الإنشاء، استخدم المشتريات أو مستندات المخزون لتغيير الكميات. إيقاف المكونات يؤثر على الفواتير المستقبلية فقط ولا يغيّر الفواتير السابقة.

## API and maintenance

- Product writes accept `uses_spare_parts` and `spare_parts: [{ product_id, quantity_per_unit }]`. Omit both to preserve an existing recipe; set `uses_spare_parts: false` to clear it. Quantities have up to four decimal places.
- Creation accepts optional `initial_stock: { quantity, warehouse_id, date, unit_cost, batch_no, expiry_date, serial_numbers }`. Quantity and cost are per base unit. Positive quantity requires a valid active warehouse; date defaults to today and cost defaults to purchase price. Initial stock is prohibited on product updates.
- Product detail and sale-price lookup responses include `spare_parts` with bilingual names, base units, quantities, and available stock. Price lookups respect the selected warehouse and warehouse access restrictions.
- Trade-document lines expose `components` for actual movements and `source_line.components` for linked-return previews. `unit_cost` remains the parent's cost; `component_cost_amount` records additional parts cost, and `cost_amount` includes both. Cost fields follow existing permissions.
- The additive company migration runs through `erp:upgrade`. Backups contain the recipe, component snapshots, and stock movements. No old sales are backfilled. Existing packaged apps need a new distribution build containing these source changes.

Validation:

```sh
cd backend
php artisan test --compact
cd ../desktop
npm run typecheck
npm test
npm run verify:translations
npm run build
npm run verify:spare-parts
```

`verify:spare-parts` creates a temporary SQLite company, runs the real Laravel HTTP backend and actual Electron-rendered editors, checks item creation → invoice posting → partial return, and saves screenshots and verification results in the printed temporary artifact directory. It does not use the client's company database.
