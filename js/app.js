/* ===========================================================
   منطق مشترک فروشگاه: خواندن محصولات از JSON، سبد خرید، هدر
   =========================================================== */

const CART_KEY = "storefa_cart";

/* ---------- ابزار قیمت ---------- */
function formatPrice(n){
  return n.toLocaleString("fa-IR") + " تومان";
}

/* ---------- خواندن محصولات ----------
   کاتالوگ کالاها از بک‌اند (Cloudflare Worker) خوانده می‌شود — این خودِ
   منبع اصلیِ داده است، نه یک فایل استاتیک. آدرس بک‌اند در js/config.js
   (متغیر API_BASE) تنظیم می‌شود. کالاهایی که از admin.html اضافه/حذف
   می‌شوند مستقیم روی همین بک‌اند ذخیره می‌شوند و همینجا برای همه‌ی
   بازدیدکننده‌ها نمایش داده می‌شوند.

   نکته‌ی مهم: قبلاً هر بار که سبد خرید باز می‌شد، دوباره کل کاتالوگ از
   بک‌اند خوانده می‌شد (یک fetch اضافه، دقیقاً همان چیزی که باعث تاخیر
   محسوس موقع افزودن به سبد می‌شد). حالا نتیجه به‌مدت ۲۰ ثانیه در حافظه
   نگه داشته می‌شود؛ صفحات ادمین بعد از افزودن/حذف کالا با
   invalidateProductsCache() این حافظه را پاک می‌کنند تا لیست همیشه
   واقعی بماند. */
let _productsCache = null;
let _productsCacheAt = 0;
const PRODUCTS_CACHE_MS = 20000;

async function loadAllProducts(){
  const now = Date.now();
  if(_productsCache && (now - _productsCacheAt) < PRODUCTS_CACHE_MS){
    return _productsCache;
  }
  try{
    const res = await fetch(`${API_BASE}/api/products`, { cache: "no-store" });
    const data = await res.json();
    _productsCache = data.products || [];
    _productsCacheAt = Date.now();
    return _productsCache;
  }catch(e){
    console.error("خطا در خواندن کاتالوگ از بک‌اند", e);
    return _productsCache || [];
  }
}
function invalidateProductsCache(){
  _productsCache = null;
  _productsCacheAt = 0;
}

async function getProductById(id){
  const all = await loadAllProducts();
  return all.find(p => p.id === id);
}

/* ---------- پاک‌سازی سبد از کالاهای حذف‌شده ----------
   اگر کالایی که قبلاً به سبد اضافه شده از فروشگاه حذف شده باشد (یا
   کاتالوگ عوض شده باشد)، همان یک آیتم باعث می‌شد کل درخواست پرداخت با
   خطای «کالا پیدا نشد» رد شود، بدون این‌که کاربر بفهمد کدام کالا مشکل
   دارد. این تابع قبل از نمایش سبد/پرداخت، آیتم‌های نامعتبر را خودکار
   حذف و به کاربر اطلاع می‌دهد. */
async function reconcileCart(){
  const all = await loadAllProducts();
  const cart = getCart();
  const valid = cart.filter(i => all.some(p => p.id === i.id));
  if(valid.length !== cart.length){
    saveCart(valid);
    showToast("برخی کالاهای سبد شما دیگر در فروشگاه موجود نبودند و حذف شدند");
  }
  return all;
}

/* ---------- سبد خرید ---------- */
function getCart(){
  return JSON.parse(localStorage.getItem(CART_KEY) || "[]");
}
function saveCart(cart){
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartCountBadge();
}
function cartLineKey(id, size, color){
  return `${id}__${size||""}__${color||""}`;
}
function addToCart(product, qty, size, color){
  const cart = getCart();
  const key = cartLineKey(product.id, size, color);
  const existing = cart.find(i => cartLineKey(i.id, i.size, i.color) === key);
  if(existing){
    existing.qty += qty;
  }else{
    cart.push({ id: product.id, qty, size: size || null, color: color || null });
  }
  saveCart(cart);
  showToast(`«${product.name}» به سبد خرید اضافه شد`);
}
function updateCartQty(id, size, color, newQty){
  let cart = getCart();
  const key = cartLineKey(id, size, color);
  if(newQty <= 0){
    cart = cart.filter(i => cartLineKey(i.id, i.size, i.color) !== key);
  }else{
    const item = cart.find(i => cartLineKey(i.id, i.size, i.color) === key);
    if(item) item.qty = newQty;
  }
  saveCart(cart);
  renderCartDrawer();
}
function removeFromCart(id, size, color){
  updateCartQty(id, size, color, 0);
}
function cartCount(cart){
  return cart.reduce((s,i)=> s + i.qty, 0);
}

function updateCartCountBadge(){
  const el = document.getElementById("cartCount");
  if(!el) return;
  const count = cartCount(getCart());
  el.textContent = count;
  el.style.display = count > 0 ? "flex" : "none";
}

/* ---------- ترسیم سبد خرید (drawer) ---------- */
async function renderCartDrawer(){
  const wrap = document.getElementById("cartItems");
  const footWrap = document.getElementById("cartFoot");
  if(!wrap) return;

  const all = await reconcileCart(); // کالاهای حذف‌شده را قبل از نمایش پاک می‌کند
  const cart = getCart();
  updateCartCountBadge();

  if(cart.length === 0){
    wrap.innerHTML = `<div class="cart-empty">
      <p>سبد خرید شما خالی است 🌸</p>
    </div>`;
    if(footWrap) footWrap.style.display = "none";
    return;
  }
  if(footWrap) footWrap.style.display = "flex";

  let total = 0;
  wrap.innerHTML = cart.map(item=>{
    const p = all.find(pp => pp.id === item.id);
    if(!p) return "";
    const lineTotal = p.price * item.qty;
    total += lineTotal;
    const img = (p.images && p.images[0]) || "";
    return `
    <div class="cart-item">
      <div class="cart-item-img"><img src="${img}" alt="${p.name}"></div>
      <div class="cart-item-info">
        <div class="name">${p.name}</div>
        <div class="meta">${[item.size,item.color].filter(Boolean).join(" · ") || "&nbsp;"}</div>
        <div class="qty-row">
          <div class="qty-control">
            <button onclick="updateCartQty('${p.id}', ${item.size ? `'${item.size}'`:null}, ${item.color?`'${item.color}'`:null}, ${item.qty-1})">−</button>
            <span>${item.qty}</span>
            <button onclick="updateCartQty('${p.id}', ${item.size ? `'${item.size}'`:null}, ${item.color?`'${item.color}'`:null}, ${item.qty+1})">+</button>
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <span class="item-price">${formatPrice(lineTotal)}</span>
            <button class="remove-link" onclick="removeFromCart('${p.id}', ${item.size ? `'${item.size}'`:null}, ${item.color?`'${item.color}'`:null})">حذف</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join("");

  const totalEl = document.getElementById("cartTotal");
  if(totalEl) totalEl.textContent = formatPrice(total);
}

function getCartTotal(all, cart){
  return cart.reduce((sum, item)=>{
    const p = all.find(pp=>pp.id===item.id);
    return sum + (p ? p.price*item.qty : 0);
  },0);
}

/* ---------- درِاور و منو ----------
   نکته‌ی مهم: باز/بسته‌شدن سبد خرید و منوی موبایل با state واضح مدیریت
   می‌شود (نه toggle کور روی overlay)، وگرنه اگر یکی باز بود و دیگری هم
   toggle می‌شد، overlay ناخواسته مخفی می‌ماند و امکان بستن با تپ بیرون
   از بین می‌رفت. */
function lockScroll(){
  document.documentElement.classList.add("no-scroll");
  document.body.classList.add("no-scroll");
}
function unlockScroll(){
  if(!isCartOpen() && !isNavOpen()){
    document.documentElement.classList.remove("no-scroll");
    document.body.classList.remove("no-scroll");
  }
}
function isCartOpen(){
  return document.getElementById("cartDrawer")?.classList.contains("open");
}
function isNavOpen(){
  return document.getElementById("mainNav")?.classList.contains("open");
}
function syncOverlay(){
  const overlay = document.getElementById("overlay");
  if(!overlay) return;
  overlay.classList.toggle("show", isCartOpen() || isNavOpen());
}

function openCart(){
  closeNav();
  document.getElementById("cartDrawer")?.classList.add("open");
  syncOverlay();
  lockScroll();
  renderCartDrawer();
}
function closeCart(){
  document.getElementById("cartDrawer")?.classList.remove("open");
  syncOverlay();
  unlockScroll();
}
function openNav(){
  closeCart();
  document.getElementById("mainNav")?.classList.add("open");
  syncOverlay();
  lockScroll();
}
function closeNav(){
  document.getElementById("mainNav")?.classList.remove("open");
  syncOverlay();
  unlockScroll();
}
function toggleMobileNav(){
  if(isNavOpen()) closeNav();
  else openNav();
}
function closeAllOverlays(){
  closeCart();
  closeNav();
}

/* ---------- توست ---------- */
let toastTimer;
function showToast(msg){
  const t = document.getElementById("toast");
  if(!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> t.classList.remove("show"), 2200);
}

/* ---------- راه‌اندازی هدر مشترک ---------- */
function initHeaderBase(){
  updateCartCountBadge();
  const overlay = document.getElementById("overlay");
  if(overlay){
    overlay.addEventListener("click", closeAllOverlays);
  }
  document.addEventListener("keydown", (e)=>{
    if(e.key === "Escape") closeAllOverlays();
  });
}
document.addEventListener("DOMContentLoaded", initHeaderBase);
