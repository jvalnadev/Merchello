angular.module('merchello').controller('Merchello.Backoffice.ProductDetachedContentController',
    ['$scope', '$q', '$log', '$route', '$routeParams', '$location', 'editorState', 'notificationsService', 'dialogService', 'localizationService', 'merchelloTabsFactory', 'dialogDataFactory',
        'contentResource', 'detachedContentResource', 'productResource', 'settingsResource',
        'detachedContentHelper', 'productDisplayBuilder', 'productVariantDetachedContentDisplayBuilder',
        function($scope, $q, $log, $route, $routeParams, $location, editorState, notificationsService, dialogService, localizationService, merchelloTabsFactory, dialogDataFactory,
                 contentResource, detachedContentResource, productResource, settingsResource,
                 detachedContentHelper, productDisplayBuilder, productVariantDetachedContentDisplayBuilder) {

            $scope.loaded = false;
            $scope.preValuesLoaded = false;
           // $scope.currentSection = appState.getSectionState("currentSection");
            $scope.productVariant = {};
            $scope.language = '';
            $scope.languages = [];
            $scope.isVariant = false;
            $scope.isConfigured = false;
            $scope.defaultLanguage = 'en-US';
            $scope.contentType = {};
            $scope.detachedContent = {};
            $scope.tabs = [];

            // Umbraco properties
            $scope.contentTabs = [];
            $scope.currentTab = null;

            $scope.openRemoveDetachedContentDialog = openRemoveDetachedContentDialog;

            // navigation switches
            var render = '';
            var slugLabel = '';
            var slugLabelDescription = '';
            var selectTemplateLabel = '';
            var showUmbracoTabs = true;
            var merchelloTabs = ['productcontent','variantlist', 'optionslist'];
            var umbracoTabs = [];

            $scope.save = save;
            $scope.saveContentType = createDetachedContent;
            $scope.setLanguage = setLanguage;

            var settings = {};
            var product = {};
            var loadArgs = {
                key: '',
                productVariantKey: ''
            };

            // initialize
            function init() {
                var key = $routeParams.id;

                // extended content is not valid unless we have a product to attach it to
                if (key === '' || key === undefined) {
                    $location.url('/merchello/merchello/productlist/manage', true);
                }
                var productVariantKey = $routeParams.variantid;
                loadArgs.key = key;
                loadArgs.productVariantKey = productVariantKey;

                var deferred = $q.defer();
                $q.all([
                    settingsResource.getAllSettings(),
                    detachedContentResource.getAllLanguages(),
                    localizationService.localize('merchelloTabs_render'),
                    localizationService.localize('merchelloDetachedContent_slug'),
                    localizationService.localize('merchelloDetachedContent_slugDescription'),
                    localizationService.localize('merchelloDetachedContent_selectTemplate'),
                ]).then(function(results) {
                    deferred.resolve(results);
                });

                deferred.promise.then(function(data) {
                    settings = data[0];
                    $scope.languages = _.sortBy(data[1], 'name');
                    $scope.defaultLanguage = settings.defaultExtendedContentCulture;
                    if($scope.defaultLanguage !== '' && $scope.defaultLanguage !== undefined) {
                        $scope.language = _.find($scope.languages, function(l) { return l.isoCode === $scope.defaultLanguage; });
                    }
                    render = data[2];
                    slugLabel = data[3];
                    slugLabelDescription = data[4];
                    selectTemplateLabel = data[5];
                    loadProduct(loadArgs);
                }, function(reason) {
                    notificationsService.error('Failed to load ' + reason);
                });
            }

            // loads the product from the resource
            function loadProduct(args) {
                productResource.getByKey(args.key).then(function(p) {

                    product = productDisplayBuilder.transform(p);
                    if(args.productVariantKey === '' || args.productVariantKey === undefined) {
                        // this is a product edit.
                        // we use the master variant context so that we can use directives associated with variants
                        $scope.productVariant = product.getMasterVariant();

                        if (!product.hasVariants()) {
                            $scope.tabs = merchelloTabsFactory.createProductEditorTabs(args.key);
                        }
                        else
                        {
                            $scope.tabs = merchelloTabsFactory.createProductEditorWithOptionsTabs(args.key);
                        }
                    } else {
                        // this is a product variant edit
                        // in this case we need the specific variant
                        $scope.productVariant = product.getProductVariant(args.productVariantKey);
                        $scope.tabs = merchelloTabsFactory.createProductVariantEditorTabs(args.key, args.productVariantKey);
                        $scope.isVariant = true;
                    }

                    //editorState.set($scope.productVariant);

                    $scope.loaded = true;

                    if ($scope.productVariant.hasDetachedContent()) {
                        $scope.productVariant.assertLanguageContent($scope.languages);
                        $scope.detachedContent = $scope.productVariant.getDetachedContent($scope.language.isoCode);
                        $scope.isConfigured = true;
                        loadScaffold();
                    } else {
                        $scope.preValuesLoaded = true;
                    }
                    $scope.tabs.setActive('productcontent');
                });
            }

            // The content type scaffold
            function loadScaffold() {
                // every detached content associated with a variant MUST share the same content type,
                var detachedContentType = $scope.productVariant.detachedContentType();

                contentResource.getScaffold(-20, detachedContentType.umbContentType.alias).then(function(scaffold) {
                    filterTabs(scaffold);
                    fillValues();
                    if ($scope.contentTabs.length > 0) {
                        if ($scope.currentTab === null) {
                            $scope.currentTab = $scope.contentTabs[0];
                        }
                        setTabVisibility();
                    }
                    // add the rendering tab
                    if ($scope.productVariant.master) {
                        var umbContentType = $scope.detachedContent.detachedContentType.umbContentType;
                        var args = {
                            tabId: 'render',
                            tabAlias: render,
                            tabLabel: render,
                            slugLabel: slugLabel,
                            slugDescription: slugLabelDescription,
                            templateLabel: selectTemplateLabel,
                            slug: $scope.detachedContent.slug,
                            templateId: $scope.detachedContent.templateId,
                            allowedTemplates: umbContentType.allowedTemplates,
                            defaultTemplateId: umbContentType.defaultTemplateId
                        };

                        var rt = detachedContentHelper.buildRenderTab(args);
                        $scope.contentTabs.push(rt);
                        umbracoTabs.push(rt.id);
                        $scope.tabs.addActionTab(rt.id, rt.label, switchTab)
                    }

                    $scope.tabs.setActive($scope.currentTab.id);
                    $scope.preValuesLoaded = true;
                });
            }

            function save() {
                if ($scope.productVariant.hasDetachedContent()) {
                    saveDetachedContent();
                }
            }

            function createDetachedContent(detachedContent) {
                if(!$scope.productVariant.hasDetachedContent()) {
                    // create detached content values for each language present
                    var isoCodes = _.pluck($scope.languages, 'isoCode');
                    contentResource.getScaffold(-20, detachedContent.umbContentType.alias).then(function(scaffold) {
                        filterTabs(scaffold);
                        angular.forEach(isoCodes, function(cultureName) {
                           var productVariantContent = buildProductVariantDetachedContent(cultureName, detachedContent, $scope.contentTabs);
                            $scope.productVariant.detachedContents.push(productVariantContent);
                        });

                        // we have to save here without assigning the scope.detachedContent otherwise we will only save the scaffold for the current language
                        // but the helper is expecting the scope value to be set.
                        saveWithoutEvents();

                    });
                }
            }

            // save when the language is changed
            function setLanguage(lang) {
                $scope.language = lang;
                $scope.contentTabs = [];
                umbracoTabs = [];
                $scope.currentTab = null;
                saveDetachedContent();

            }

            function saveWithoutEvents() {
                var promise;
                if ($scope.productVariant.master) {
                    promise = productResource.save(product);
                } else {
                    promise = productResource.saveVariant($scope.productVariant);
                }
                promise.then(function(data) {
                    $scope.loaded = false;
                    $scope.preValuesLoaded = false;
                    loadProduct(loadArgs);
                });
            }

            function saveDetachedContent() {
                var promise;
                if ($scope.productVariant.master) {
                    promise = detachedContentHelper.detachedContentPerformSave({ saveMethod: productResource.save, content: product, scope: $scope, statusMessage: 'Saving...' });
                } else {
                    promise = detachedContentHelper.detachedContentPerformSave({ saveMethod: productResource.saveVariant, content: $scope.productVariant, scope: $scope, statusMessage: 'Saving...' });
                }
                promise.then(function(data) {
                    $scope.loaded = false;
                    $scope.preValuesLoaded = false;
                    loadProduct(loadArgs);
                });
            }


            function buildProductVariantDetachedContent(cultureName, detachedContent, tabs) {
                var productVariantContent = productVariantDetachedContentDisplayBuilder.createDefault();
                productVariantContent.cultureName = cultureName;
                productVariantContent.productVariantKey = $scope.productVariantKey;
                productVariantContent.detachedContentType = detachedContent;
                angular.forEach(tabs, function(tab) {
                    angular.forEach(tab.properties, function(prop) {
                        productVariantContent.detachedDataValues.setValue(prop.alias, angular.toJson(prop.value));
                    })
                });
                return productVariantContent;
            }

            function filterTabs(scaffold) {
                $scope.contentTabs = _.filter(scaffold.tabs, function(t) { return t.id !== 0 });
                if ($scope.contentTabs.length > 0) {
                    angular.forEach($scope.contentTabs, function(ct) {
                        $scope.tabs.addActionTab(ct.id, ct.label, switchTab);
                        umbracoTabs.push(ct.id);
                    });
                }
            }

            function setTabVisibility() {
                if (showUmbracoTabs) {
                    angular.forEach(merchelloTabs, function(mt) {
                      $scope.tabs.hideTab(mt);
                    });
                }
            }

            function switchTab(id) {
                var exists = _.find(umbracoTabs, function(ut) {
                    return ut === id;
                });
                if (exists !== undefined) {
                    var fnd = _.find($scope.contentTabs, function (ct) {
                        return ct.id === id;
                    });
                    $scope.currentTab = fnd;
                    $scope.tabs.setActive(id);
                }
            }

            function fillValues() {
                if ($scope.contentTabs.length > 0) {
                    angular.forEach($scope.contentTabs, function(ct) {
                        angular.forEach(ct.properties, function(p) {
                            var stored = $scope.detachedContent.detachedDataValues.getValue(p.alias);
                            if (stored !== '') {
                                p.value = angular.fromJson(stored);
                            }
                        });
                    });
                }
            }

            function openRemoveDetachedContentDialog() {
                var deferred = $q.defer();
                $q.all([
                    localizationService.localize('merchelloTabs_detachedContent'),
                    localizationService.localize('merchelloDetachedContent_removeDetachedContentWarning')
                ]).then(function(data) {
                    deferred.resolve(data);
                });

                deferred.promise.then(function(value) {

                    var dialogData = {
                        name : $scope.productVariant.name + ' ' + value[0],
                        warning: value[1]
                    };

                    dialogService.open({
                        template: '/App_Plugins/Merchello/Backoffice/Merchello/Dialogs/delete.confirmation.html',
                        show: true,
                        callback: processRemoveDetachedContent,
                        dialogData: dialogData
                    });
                });
            }

            function processRemoveDetachedContent(dialogData) {
                $scope.loaded = true;
                $scope.preValuesLoaded = false;
                productResource.deleteDetachedContent($scope.productVariant).then(function(result) {
                    $route.reload();
                }, function(reason) {
                    notificationsService.error('Failed to delete detached content ' + reason);
                });
            }

            // Initialize the controller
            init();
    }]);
