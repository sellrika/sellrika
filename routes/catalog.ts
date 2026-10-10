import { Guard } from "@xcore/auth/Guard";
import { router } from "@xcore/http/Router";
import { CategoryController } from "@controllers/Category.Controller";
import { ProductController } from "@controllers/Product.Controller";
import { StockController } from "@controllers/Stock.Controller";

/** Products, categories and stock. Inside `auth`, then `manager`. */
function managerRoutes() {
	/**
	 * Universal POS Product CSV v1.
	 * Static paths come before the resource's /:id.
	 */
	router.get("/products/export", [ProductController, "exportCsv"]);
	router.post("/products/import", [ProductController, "importCsv"]);
	/** Bulk: add categories to many products. */
	router.post("/products/categories", [ProductController, "addCategories"]);
	router.post("/products/:id/featured", [ProductController, "featured"]);
	router.post("/products/:id/active", [ProductController, "active"]);
	router.resource("/products", ProductController);
	router.resource("/categories", CategoryController);

	router.get("/stock", [StockController, "index"]);
	/** Every count change is a stock_movements row. */
	router.post("/stock/adjust", [StockController, "adjust"]);
	router.get("/stock/movements", [StockController, "movements"]);
}

/**
 * The Catalog side of the sidebar (like `app/services/catalog/`).
 * Products, categories, stock: managers and admins.
 */
export function catalogRoutes() {
	router.group([Guard.auth, Guard.manager], managerRoutes);
}
