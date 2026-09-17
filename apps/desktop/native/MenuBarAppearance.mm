#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>
#include <node_api.h>
#include <cstring>

static NSStatusBarButton *FindStatusButton(NSView *view, NSString *tooltip);

// NSPopover 管理系统玻璃、箭头和屏幕边缘避让；透明 Electron 子窗口只承载交互内容。
// 不移动 Chromium 的 NSView，也不旋转玻璃视图，避免破坏宿主布局和输入事件。
@interface ZeusMenuPopover : NSObject <NSPopoverDelegate>
@property(nonatomic, weak) NSWindow *host;
@property(nonatomic, weak) NSStatusBarButton *button;
@property(nonatomic, strong) NSPopover *popover;
@property(nonatomic, strong) id closeObserver;
- (instancetype)initWithWindow:(NSWindow *)window;
- (void)showFromButton:(NSStatusBarButton *)button;
- (void)close;
@end

@implementation ZeusMenuPopover
- (instancetype)initWithWindow:(NSWindow *)window {
    if ((self = [super init])) {
        self.host = window;
        self.popover = [NSPopover new];
        self.popover.behavior = NSPopoverBehaviorApplicationDefined;
        self.popover.animates = NO;
        self.popover.delegate = self;
        NSViewController *controller = [NSViewController new];
        controller.view = [[NSView alloc] initWithFrame:window.contentView.bounds];
        self.popover.contentViewController = controller;
        __weak ZeusMenuPopover *weakSelf = self;
        self.closeObserver = [[NSNotificationCenter defaultCenter]
            addObserverForName:NSWindowWillCloseNotification object:window queue:nil
            usingBlock:^(NSNotification *note) { [weakSelf close]; }];
    }
    return self;
}
- (void)showFromButton:(NSStatusBarButton *)button {
    NSWindow *host = self.host;
    if (!host) return;
    self.button = button;
    self.popover.contentSize = host.contentView.bounds.size;
    self.popover.appearance = host.appearance;
    [self.popover showRelativeToRect:button.bounds ofView:button preferredEdge:NSMinYEdge];
    NSView *content = self.popover.contentViewController.view;
    NSWindow *background = content.window;
    // 弹窗连接到状态按钮后，显式同步其背景窗口，避免重新继承菜单栏的浅色外观。
    content.appearance = host.appearance;
    background.appearance = host.appearance;
    NSLog(@"Zeus menu bar appearance: requested=%@ effective=%@", host.appearance.name, background.effectiveAppearance.name);
    background.level = NSPopUpMenuWindowLevel;
    background.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary;
    NSRect frame = [background convertRectToScreen:[content convertRect:content.bounds toView:nil]];
    host.hasShadow = NO;
    [host setFrame:frame display:YES];
    [background addChildWindow:host ordered:NSWindowAbove];
    [host makeKeyAndOrderFront:nil];
    [button highlight:YES];
}
- (void)close {
    if (self.popover.shown) [self.popover close];
}
- (void)popoverDidClose:(NSNotification *)notification {
    [self.button highlight:NO];
    NSWindow *host = self.host;
    [host.parentWindow removeChildWindow:host];
    [host orderOut:nil];
}
- (BOOL)popoverShouldDetach:(NSPopover *)popover { return NO; }
- (void)dealloc {
    [[NSNotificationCenter defaultCenter] removeObserver:self.closeObserver];
}
@end

static char popoverKey;
static NSView *ViewFromHandle(napi_env env, napi_value value) {
    bool isBuffer = false;
    size_t length = 0;
    void *bytes = nullptr, *pointer = nullptr;
    if (![NSThread isMainThread] || napi_is_buffer(env, value, &isBuffer) != napi_ok || !isBuffer ||
        napi_get_buffer_info(env, value, &bytes, &length) != napi_ok || length != sizeof(void *)) return nil;
    memcpy(&pointer, bytes, sizeof(pointer));
    return (__bridge NSView *)pointer;
}

static napi_value ShowPopover(napi_env env, napi_callback_info info) {
    size_t argc = 2, length = 0;
    napi_value args[2], result;
    char tooltip[2048];
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    NSView *view = argc == 2 ? ViewFromHandle(env, args[0]) : nil;
    if (!view.window || napi_get_value_string_utf8(env, args[1], tooltip, sizeof(tooltip), &length) != napi_ok) {
        napi_throw_type_error(env, nullptr, "菜单栏窗口参数无效");
        return nullptr;
    }
    NSStatusBarButton *button = nil;
    for (NSWindow *window in NSApp.windows) {
        button = FindStatusButton(window.contentView, [NSString stringWithUTF8String:tooltip]);
        if (button) break;
    }
    if (!button) {
        napi_throw_error(env, nullptr, "未找到本应用的菜单栏状态按钮");
        return nullptr;
    }
    @try {
        ZeusMenuPopover *controller = objc_getAssociatedObject(view, &popoverKey);
        if (!controller) {
            controller = [[ZeusMenuPopover alloc] initWithWindow:view.window];
            objc_setAssociatedObject(view, &popoverKey, controller, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        }
        [controller showFromButton:button];
        napi_get_boolean(env, controller.popover.shown, &result);
        return result;
    } @catch (NSException *exception) {
        napi_throw_error(env, nullptr, exception.reason.UTF8String);
        return nullptr;
    }
}

// 浮窗跟随应用主题；状态栏按钮仍独立跟随菜单栏背景。
static napi_value SetPopoverAppearance(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value args[2], result;
    bool dark = false;
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    NSView *view = argc == 2 ? ViewFromHandle(env, args[0]) : nil;
    if (!view.window || napi_get_value_bool(env, args[1], &dark) != napi_ok) {
        napi_throw_type_error(env, nullptr, "菜单栏主题参数无效");
        return nullptr;
    }
    NSAppearance *appearance = [NSAppearance appearanceNamed:dark ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
    view.window.appearance = appearance;
    ZeusMenuPopover *controller = objc_getAssociatedObject(view, &popoverKey);
    controller.popover.appearance = appearance;
    controller.popover.contentViewController.view.appearance = appearance;
    controller.popover.contentViewController.view.window.appearance = appearance;
    napi_get_undefined(env, &result);
    return result;
}

static napi_value HidePopover(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value arg, result;
    napi_get_cb_info(env, info, &argc, &arg, nullptr, nullptr);
    NSView *view = argc == 1 ? ViewFromHandle(env, arg) : nil;
    if (!view) {
        napi_throw_type_error(env, nullptr, "菜单栏窗口参数无效");
        return nullptr;
    }
    ZeusMenuPopover *controller = objc_getAssociatedObject(view, &popoverKey);
    [controller close];
    napi_get_undefined(env, &result);
    return result;
}

// 菜单栏明暗独立于应用主题，与 AgentDesk 一样监听按钮的实际 appearance。
@interface ZeusTrayAppearance : NSObject
@property(nonatomic, weak) NSStatusBarButton *button;
@property(nonatomic, strong) NSImage *light;
@property(nonatomic, strong) NSImage *dark;
@property(nonatomic, copy) NSString *lastAppearance;
- (void)update;
@end
@implementation ZeusTrayAppearance
- (void)update {
    NSStatusBarButton *button = self.button;
    if (!button) return;
    NSString *appearance = [button.effectiveAppearance bestMatchFromAppearancesWithNames:@[NSAppearanceNameAqua, NSAppearanceNameDarkAqua]];
    if ([appearance isEqualToString:self.lastAppearance]) return;
    self.lastAppearance = appearance;
    button.image = [appearance isEqualToString:NSAppearanceNameDarkAqua] ? self.dark : self.light;
    button.alternateImage = self.dark;
}
- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object change:(NSDictionary *)change context:(void *)context {
    dispatch_async(dispatch_get_main_queue(), ^{ [self update]; });
}
- (void)dealloc {
    [self.button removeObserver:self forKeyPath:@"effectiveAppearance"];
}
@end

static NSStatusBarButton *FindStatusButton(NSView *view, NSString *tooltip) {
    if ([view.toolTip isEqualToString:tooltip]) {
        for (NSView *parent = view; parent; parent = parent.superview) {
            if ([parent isKindOfClass:[NSStatusBarButton class]]) return (NSStatusBarButton *)parent;
        }
    }
    for (NSView *child in view.subviews) {
        NSStatusBarButton *button = FindStatusButton(child, tooltip);
        if (button) return button;
    }
    return nil;
}

static NSImage *ImageFromBuffer(napi_env env, napi_value value) {
    bool isBuffer = false;
    size_t length = 0;
    void *bytes = nullptr;
    if (napi_is_buffer(env, value, &isBuffer) != napi_ok || !isBuffer ||
        napi_get_buffer_info(env, value, &bytes, &length) != napi_ok || length > 100000) return nil;
    NSImage *image = [[NSImage alloc] initWithData:[NSData dataWithBytes:bytes length:length]];
    NSBitmapImageRep *bitmap = [NSBitmapImageRep imageRepWithData:[NSData dataWithBytes:bytes length:length]];
    if (image && bitmap) image.size = NSMakeSize(bitmap.pixelsWide / 2.0, 22);
    [image setTemplate:NO];
    return image;
}

static napi_value ApplyTray(napi_env env, napi_callback_info info) {
    size_t argc = 3, length = 0;
    napi_value args[3], result;
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    char tooltip[2048];
    if (argc != 3 || napi_get_value_string_utf8(env, args[2], tooltip, sizeof(tooltip), &length) != napi_ok || ![NSThread isMainThread]) {
        napi_throw_type_error(env, nullptr, "状态栏外观参数无效");
        return nullptr;
    }
    NSImage *light = ImageFromBuffer(env, args[0]);
    NSImage *dark = ImageFromBuffer(env, args[1]);
    if (!light || !dark) {
        napi_throw_type_error(env, nullptr, "状态栏图像无效");
        return nullptr;
    }
    NSStatusBarButton *button = nil;
    for (NSWindow *window in NSApp.windows) {
        button = FindStatusButton(window.contentView, [NSString stringWithUTF8String:tooltip]);
        if (button) break;
    }
    if (button) {
        static char key;
        ZeusTrayAppearance *observer = objc_getAssociatedObject(button, &key);
        if (!observer) {
            observer = [ZeusTrayAppearance new];
            observer.button = button;
            [button addObserver:observer forKeyPath:@"effectiveAppearance" options:0 context:nil];
            objc_setAssociatedObject(button, &key, observer, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        }
        observer.light = light;
        observer.dark = dark;
        observer.lastAppearance = nil;
        [observer update];
    }
    napi_get_boolean(env, button != nil, &result);
    return result;
}

static napi_value Initialize(napi_env env, napi_value exports) {
    napi_property_descriptor properties[] = {
        {"showPopover", nullptr, ShowPopover, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"hidePopover", nullptr, HidePopover, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"setPopoverAppearance", nullptr, SetPopoverAppearance, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"applyTray", nullptr, ApplyTray, nullptr, nullptr, nullptr, napi_default, nullptr},
    };
    napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
    return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)
