import mock_customers from "../mock_data/customers";
import PosStorage from '../database/PosStorage';
import Communications from '../services/Communications';
import Events from "react-native-simple-events";

class Synchronization {
	initialize( lastCustomerSync, lastProductSync, lastSalesSync){
		console.log("Synchronization:initialize");
		this.lastCustomerSync = lastCustomerSync;
		this.lastProductSync = lastProductSync;
		this.lastSalesSync = lastSalesSync;
		this.intervalId = null;
		this.firstSyncId = null;
		this.syncInterval = 60*1000;
		this.isConnected = false;
	}
	setConnected( isConnected ){
		console.log( "Synchronization:setConnected - " + isConnected );
		this.isConnected = isConnected;
	}
	scheduleSync( ){
		console.log( "Synchronization:scheduleSync - Starting synchronization" );
		let timeoutX = 10000; // Sync after 10 seconds
		if( this.firstSyncId != null ){
			clearTimeout( this.firstSyncId );
		}
		if( this.intervalId != null  ){
			clearInterval(this.intervalId);
		}
		if( PosStorage.getCustomers().length == 0 || PosStorage.getProducts().length == 0 ){
			// No local customers or products, sync now
			timeoutX = 1000;
		}

		let that = this;
		this.firstSyncId = setTimeout(() => {
			console.log("Synchronizing...");
			that.doSynchronize( );
		}, timeoutX);
		this.intervalId = setInterval( ()=>{
			that.doSynchronize();
		}, this.syncInterval);
	}
	updateLastCustomerSync(){
		this.lastCustomerSync = new Date();
		PosStorage.setLastCustomerSync( this.lastCustomerSync );
	}
	updateLastProductSync(){
		this.lastProductSync = new Date();
		PosStorage.setLastProductSync( this.lastProductSync );
	}
	updateLastSalesSync(){
		this.lastSalesSync = new Date();
		PosStorage.setLastSalesSync( this.lastSalesSync );
	}
	doSynchronize( ){
		if( this.isConnected ) {
			this.synchronize();
		}else{
			console.log( "Communications:doSynchronize - Won't sync - Network not connected");
		}
	}
	synchronize(){
		let syncResult = {status:"success", error:""}
		return new Promise((resolve ) => {
			try {
				this.refreshToken().then(() => {
					const promiseCustomers = this.synchronizeCustomers()
						.then( customerSync =>{
							syncResult.customers = customerSync;
						});
					const promiseProducts = this.synchronizeProducts()
						.then( productSync =>{
							syncResult.products = productSync;
						});
					const promiseSales= this.synchronizeSales()
						.then( saleSync =>{
							syncResult.sales = saleSync;
						});

					Promise.all([promiseCustomers, promiseProducts, promiseSales])
						.then( values =>{
							resolve(syncResult);
						});
				}).catch(error => {
					syncResult.error = error.message;
					syncResult.status = "failure";
					resolve(syncResult)
					console.log(error.message);
				});

			} catch (error) {
				syncResult.error = error.message;
				syncResult.status = "failure";
				resolve(syncResult)
				console.log(error.message);
			}
		});

	}
	synchronizeCustomers(){
		return new Promise( resolve => {
		console.log( "Synchronization:synchronizeCustomers - Begin" );
		Communications.getCustomers( this.lastCustomerSync )
			.then( web_customers => {
				if (web_customers.hasOwnProperty("customers")) {
					this.updateLastCustomerSync();
					console.log( "Synchronization:synchronizeCustomers No of new remote customers: " + web_customers.customers.length);
					// Get the list of customers that need to be sent to the server
					let { pendingCustomers, updated} = PosStorage.mergeCustomers( web_customers.customers );
					console.log( "Synchronization:synchronizeCustomers No of local pending customers: " + pendingCustomers.length);
					resolve( {error:null, localCustomers:  pendingCustomers.length, remoteCustomers: web_customers.customers.length});
					pendingCustomers.forEach(customerKey => {
						PosStorage.getCustomerFromKey(customerKey)
							.then( customer => {
								if (customer != null) {
									if (customer.syncAction === "create") {
										console.log("Synchronization:synchronizeCustomers -creating customer - " + customer.contactName);
										Communications.createCustomer(customer)
											.then(() => {
												console.log("Synchronization:synchronizeCustomers - Removing customer from pending list - " + customer.contactName);
												PosStorage.removePendingCustomer(customerKey)
											})
											.catch(error => console.log("Synchronization:synchronizeCustomers Create Customer failed"));
									} else if (customer.syncAction === "delete") {
										console.log("Synchronization:synchronizeCustomers -deleting customer - " + customer.contactName);
										Communications.deleteCustomer(customer)
											.then(() => {
												console.log("Synchronization:synchronizeCustomers - Removing customer from pending list - " + customer.contactName);
												PosStorage.removePendingCustomer(customerKey)
											})
											.catch(error => console.log("Synchronization:synchronizeCustomers Delete Customer failed " + error));

									} else if (customer.syncAction === "update") {
										console.log("Synchronization:synchronizeCustomers -updating customer - " + customer.contactName);
										Communications.updateCustomer(customer)
											.then(() => {
												console.log("Synchronization:synchronizeCustomers - Removing customer from pending list - " + customer.contactName);
												PosStorage.removePendingCustomer(customerKey)
											})
											.catch(error => console.log("Synchronization:synchronizeCustomers Update Customer failed " + error));

									}

								} else {
									PosStorage.removePendingCustomer(customerKey);
								}
							});
					});
					if( updated ){
						Events.trigger('CustomersUpdated', {} );
					}
				}
			})
			.catch(error => {
				console.log( "Synchronization.getCustomers - error " + error);
				resolve( {error:error.message, localCustomers:  null, remoteCustomers:null});
			});
		});
	}
	synchronizeProducts(){
		return new Promise( resolve => {
			console.log("Synchronization:synchronizeProducts - Begin");
			Communications.getProducts(this.lastProductSync)
				.then(products => {
					resolve( {error:null, remoteProducts: products.products.length});
					if (products.hasOwnProperty("products")) {
						this.updateLastProductSync();
						console.log("Synchronization:synchronizeProducts. No of new remote products: " + products.products.length);
						const updated = PosStorage.mergeProducts(products.products);
						if (updated) {
							Events.trigger('ProductsUpdated', {});
						}

					}
				})
				.catch(error => {
					resolve( {error:error.message, remoteProducts: null});
					console.log("Synchronization.getProducts - error " + error);
				});
		});
	}

	synchronizeSales(){
		return new Promise( resolve => {
			console.log("Synchronization:synchronizeSales - Begin");
			PosStorage.loadSalesReceipts(this.lastSalesSync)
				.then(salesReceipts => {
					console.log("Synchronization:synchronizeSales - Number of sales receipts: " + salesReceipts.length);
					resolve( {error:null, localReceipts:  salesReceipts.length});
					salesReceipts.forEach((receipt) => {
						Communications.createReceipt(receipt.sale)
							.then(result => {
								console.log("Synchronization:synchronizeSales - success: ");
								PosStorage.removePendingSale(receipt.key);
							})
							.catch(error => {
								console.log("Synchronization:synchronizeCustomers Create receipt failed")
							});
					})
				})
				.catch(error => {
					resolve( {error:error.message, localReceipts: null});
					console.log("Synchronization.synchronizeSales - error " + error);
				});
		});
	}

	refreshToken(){
		// Check if token exists or has expired
		return new Promise((resolve, reject ) => {
			let settings = PosStorage.getSettings();
			let tokenExpirationDate = PosStorage.getTokenExpiration();
			let currentDateTime = new Date();

			if( settings.token.length == 0 ||currentDateTime > tokenExpirationDate ){
				// Either user has previously logged out or its time for a new token
				console.log("No token or token has expired - Getting a new one");
				Communications.login()
					.then(result => {
						if (result.status === 200) {
							console.log("New token Acquired");
							PosStorage.saveSettings( settings.semaUrl, settings.site, settings.user,
								settings.password, result.response.token, settings.siteId );
							Communications.setToken(result.response.token);
							PosStorage.setTokenExpiration();
						}
						resolve();
					})
					.catch(result => {
						console.log("Failed- status " + result.status + " " + result.response);
						reject( result.response );
					})

			}else{
				console.log("Existing token is valid");
				resolve();
			}
		});
	}

}
export default  new Synchronization();
