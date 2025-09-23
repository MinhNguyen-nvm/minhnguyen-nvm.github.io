---
layout: single
classes: wide
title: "It's 2020, I still write a topic about converting Android callback API to RxJava stream"
date: 2020-02-09
author: "Minh Nguyen"
categories: [Android, RxJava, Programming]
tags: [rxjava, android, reactive-programming, callbacks, kotlin, location-services]
header:
  teaser: "/assets/images/2020-02-09-callback-to-reactive-rxjava/rxjava-callback-main.png"
excerpt: "Converting Android callback APIs to RxJava streams using Observable.create() - best practices and common pitfalls to avoid"
author_profile: false
read_time: true
comments: true
share: true
related: true
toc: false
sidebar:
  nav: "posts"
---


![RxJava Android Callback Conversion](/assets/images/2020-02-09-callback-to-reactive-rxjava/rxjava-callback-main.png)

*Originally published on [Medium](https://medium.com/@mikenguyenvan/it-is-2020-i-still-write-a-topic-about-converting-android-callback-api-to-rxjava-stream-976874ebc4f0)*

I never write any blog posts, but seeing many of my colleagues wrote their blogs and built their open-sources, encouraging me to choose a topic to start.

## Why do I choose an old topic to start

Nowadays, everyone keeps talking about Kotlin Coroutine with Channels, Flow, and so on. But until now, the beginning of 2020, RxJava still a potent tool for building Android apps that I have not found any alternative. Flow may be a good option in the feature, but not at this moment. And I still see inadequate approaches from others when they create reactive objects. Especially when they use `Observable.create()` method. I could list some of them:

1. Use the Subject instead create an Observable. This is a good topic regarding the problem with subjects from [Thomas Nield](https://tomstechnicalblog.blogspot.com/2016/03/rxjava-problem-with-subjects.html)
2. Does not call `onComplete`/`onError`/`tryOnError` when using the `Observable.create` factory method to create Observable or Flowable which could lead to leaking
3. Does not care about threading when using "create", what if the client calls `subscribeOn`.
4. Execute the logic outside of the factories method, which causes the logic being executed before the reactive stream being subscribe.
5. It does not use the power of Rxjava operation to build a clean Rxjava API. Mix the logic to convert Android API to Rxjava with the UI

## How to create an Observable/Single/Flowable/Completable

As many of you may know that we can create observable via multiple factory methods.

- `Observable.fromCallable()`
- `Observable.fromPublisher()`
- `Observable.fromFuture()`
- `Observable.fromArray()`
- `Observable.just()`
- `Observable.fromIterable()`
- `Observable.defer()`
- ...

It recommended using these methods, if possible. There are a lot of great posts about this topic on the Internet, and I should not talk about them here. What I will focus on this post are:

1. Convert Android callback-style API to the reactive world with `Observable.create()` method
2. Use Rxjava operations to design a clean API

Let's see an example of converting location API from Android & Google Play Service to RxJava stream. I choose this example because it is complicated enough to present the solution to have a clean API.

**TL;DR**: you can check out the source code in this post from [here](https://github.com/MinhNguyen-nvm/RxLocation)

## How to get location from Android

For Android devices have Google Play Service, we can fetch the location or observe location change from two sources:

1. Google Play Service (Fused Location Provider API)
2. Android API, that is LocationManager

These two sources provide us the locations with the callback API. To convert to a reactive stream, we have to use `Observable.create()` method.

Let define the API that we want to build.

Most of the apps request locations for two scenarios.

1. Getting the last known location, you can check more detail [here](https://developer.android.com/training/location/retrieve-current)
2. Listen to the location change, you can check more detail [here](https://developer.android.com/training/location/receive-location-updates)

From that requirement, we build this simple interface

```kotlin
interface RxLocationManager {
   fun singleLocation(): Single<Location>
   fun observeLocationChange(): Observable<Location>
}
```

The interface has two methods:

### `fun singleLocation(): Single<Location>`

This method will return a Single, which emits the last known location value. We get the last known location by:

1. If there is other(s) call to observe the location change from RxLocationManager, the last received location(a cache value) should be emitted
2. If there is no other call & cached location value, we will fetch the last know location from our sources(either Google Play Service or LocationManager)

### `fun observeLocationChange(): Observable<Location>`

Return an observable that will emit the location after some time if there are any observer subscribes to it (the period should be configurable)

1. It should be a hot Observable. Multiple observers should subscribe to the same observable and got the same emitted item.
2. The last emitted item should be cached. If there is a new observer subscribe to the observable, it will receive the cached location (if available) as the first item
3. The observable should cancel itself if all the observers are disposed
4. We can tell the observable to emit locations on a specific thread

## The implementation detail

First of all, as mentioned earlier, there are two sources of getting locations, from either Google Play Service or Android Location manager. They provide quite similar APIs. Therefore, I create another interface present for the location services (sources). Let call it `LocationService`

```kotlin
interface LocationService {
    fun requestLocationUpdates(attributes: RxLocationAttributes): Observable<Location>
}
```

The `LocationService.requestLocationUpdates()` method will return an Observable, which will emit the locations based on the `RxLocationAttributes` values. You can think of `RxLocationAttributes` as a configuration object tell to the location services what do we want. Let focus on the implementations.

## Implementation with FusedLocationProviderClient

Google Play Service provides us with `FusedLocationProviderClient`. There are two main methods that we will call:

1. `FusedLocationProviderClient.getLastLocation()`
2. `FusedLocationProviderClient.requestLocationUpdates()`

I create `FusedLocationService` class to implement the `LocationService` interface.

```kotlin
class FusedLocationService(
    private val context: Context,
    private val fusedLocationProviderClient: FusedLocationProviderClient
) : LocationService {

    override fun requestLocationUpdates(attributes: RxLocationAttributes): Observable<Location> {
        return createLocationObservable(attributes)
            .retry(attributes.retryAttempt) { throwable ->
                throwable !is GooglePlayServicesNotAvailableException &&
                throwable !is SecurityException
            }
    }

    private fun createLocationObservable(attributes: RxLocationAttributes): Observable<Location> {
        return Observable.create { emitter ->
            val listener = object : LocationCallback() {
                override fun onLocationResult(locationResult: LocationResult?) {
                    locationResult?.locations?.forEach { location ->
                        if (!emitter.isDisposed) {
                            emitter.onNext(location)
                        }
                    }
                }

                override fun onLocationAvailability(locationAvailability: LocationAvailability?) {
                    if (locationAvailability?.isLocationAvailable == false && !emitter.isDisposed) {
                        emitter.tryOnError(LocationNotAvailableException())
                    }
                }
            }

            // 1. Fetch last known location first
            fusedLocationProviderClient.lastLocation
                .addOnSuccessListener { location ->
                    if (location != null && !emitter.isDisposed) {
                        emitter.onNext(location)
                    }
                }
                .addOnFailureListener { exception ->
                    if (!emitter.isDisposed) {
                        emitter.tryOnError(exception)
                    }
                }

            // 2. Register for location updates
            try {
                fusedLocationProviderClient.requestLocationUpdates(
                    getLocationRequest(attributes),
                    listener,
                    if (attributes.useCalledThreadToEmitValue) null else Looper.getMainLooper()
                )
            } catch (e: Exception) {
                emitter.tryOnError(e)
                return@create
            }

            // 3. Set disposal callback
            emitter.setDisposable(Disposables.fromAction {
                fusedLocationProviderClient.removeLocationUpdates(listener)
            })
        }
    }

    private fun getLocationRequest(attributes: RxLocationAttributes): LocationRequest {
        return LocationRequest.create().apply {
            interval = attributes.updateInterval
            fastestInterval = attributes.fastestInterval
            priority = attributes.priority
        }
    }
}
```

Let focus on `createLocationObservable()` method.

1. Fetch last known location from Google Play service and emit to the stream
2. Listen to locations change from Google Play Service and emit to the stream.

Here, we create an Observable by passing an `ObservableOnSubscribe` implementation to the `Observable.create` method. Inside the `ObservableOnSubscribe`, we have to implement the `ObservableOnSubscribe.subscribe` method. This method will be called when we subscribe to the observable, it receives an `ObservableEmitter` that allows pushing events in a cancellation-safe manner.

When creating an Observable from `Observable.create`, we should make sure:

**1. Clean up resources if the ObservableEmitter is canceled or disposed.** To clean up, we have a two options, `ObservableEmitter.setDisposable()` or `ObservableEmitter.setCancellable()`. They are equivalence. The main differences are `setCancellable` will deliver the exceptions during clean up to `RxJavaPlugins.onError(Throwable)`. For our case, it's remove the `LocationUpdatesListener` from `FusedLocationProviderClient`

**2. Catch the exception and make sure calling `ObservableEmitter.tryOnError()` or `ObservableEmitter.onError()` to pass the error to the stream.** The main difference between these two methods is that `ObservableEmitter.tryOnError` will not forward the error to `RxJavaPlugins.onError` if the error could not be delivered.

```kotlin
try {
    // register the callback
} catch (e: Exception) {
    emitter.tryOnError(e)
}
```

**3. Make sure you call `ObservableEmitter.onComplete()` if the source finishes emitting the items** (applicable for Observable & Flowable). For our example, it's a hot observable, and we don't have any complete points.

**4. These methods `ObservableEmitter.onNext()`, `ObservableEmitter.onError()`, `ObservableEmitter.tryOnError()` and `ObservableEmitter.onComplete()` should be called in a sequential**

**5. What thread your observable will emit the value on.** Most of the callback API provided will emit the value to the register thread (the thread execute the registration callback to the framework) by default. In Android many callback API will require an `HandlerThread` for the default register thread and also if you want to tell to the API to call the callback in another thread, then you have to pass a looper or an handler to the API. In our example you can see:

```kotlin
fusedLocationProviderClient.requestLocationUpdates(
    getLocationRequest(attributes),
    listener,
    if (attributes.useCalledThreadToEmitValue) null else Looper.getMainLooper()
)
```

Base on the `attributes.useCalledThreadToEmitValue`, we will pass a null value or the main looper to the method.

- **Null value**: The callback will be called from the thread, which executes the `ObservableOnSubscribe.subscribe` method. Usually, it will be the thread that you subscribe to the stream, or you can tell the observable to emit the value from which thread by `subscribeOn(Thread)`. Please be aware, in our case. The thread must be a `HandlerThread`, otherwise an exception is throwed. You can read more about `HandlerThread` [here](https://blog.mindorks.com/android-core-looper-handler-and-handlerthread-bd54d69fe91a) or [here](https://medium.com/@ankit.sinhal/handler-in-android-d138c1f4c5e7).
- **Looper.getMainLooper()**: We default the callback will be called from the main thread. It means that the Observable will emit location from the main thread even you applied `subscribeOn(Thread)` to the stream.

That is, regarding create the Observable by `Observable.create` method.

Let look more detail on the `FusedLocationService.requestLocationUpdates` method

```kotlin
override fun requestLocationUpdates(attributes: RxLocationAttributes): Observable<Location> {
    return createLocationObservable(attributes)
        .retry(attributes.retryAttempt) { throwable ->
            throwable !is GooglePlayServicesNotAvailableException &&
            throwable !is SecurityException
        }
}
```

We will retry the observable `attribute.retryAttempt` times, if any errors occurred excepts `GooglePlayServicesNotAvailableException` (Google play services is not available) or `SecurityException`(permission has not granted). Be aware that we can set `attribute.retryAttempt` via `RxLocationAttributes`.

So, with the same approach, I have an implementation to getting the location from Android API (`LocationManager`)

```kotlin
class AndroidLocationService(
    private val context: Context,
    private val locationManager: LocationManager
) : LocationService {

    override fun requestLocationUpdates(attributes: RxLocationAttributes): Observable<Location> {
        return createLocationObservable(attributes)
            .retry(attributes.retryAttempt) { throwable ->
                throwable !is SecurityException
            }
    }

    private fun createLocationObservable(attributes: RxLocationAttributes): Observable<Location> {
        return Observable.create { emitter ->
            val listener = object : LocationListener {
                override fun onLocationChanged(location: Location) {
                    if (!emitter.isDisposed) {
                        emitter.onNext(location)
                    }
                }

                override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}

                override fun onProviderEnabled(provider: String?) {}

                override fun onProviderDisabled(provider: String?) {
                    if (!emitter.isDisposed) {
                        emitter.tryOnError(LocationProviderDisabledException(provider))
                    }
                }
            }

            // Get last known location first
            try {
                val lastKnownLocation = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                if (lastKnownLocation != null && !emitter.isDisposed) {
                    emitter.onNext(lastKnownLocation)
                }
            } catch (e: SecurityException) {
                emitter.tryOnError(e)
                return@create
            }

            // Register for location updates
            try {
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    attributes.updateInterval,
                    attributes.minDistance.toFloat(),
                    listener,
                    if (attributes.useCalledThreadToEmitValue) null else Looper.getMainLooper()
                )
            } catch (e: Exception) {
                emitter.tryOnError(e)
                return@create
            }

            emitter.setDisposable(Disposables.fromAction {
                locationManager.removeUpdates(listener)
            })
        }
    }
}
```

## Implement the RxLocationManager interface

Now it's the time for us to integrate the two services, and implement the interface `RxLocationManager` that we designed at the beginning.

```kotlin
class RxLocationManagerImpl(
    private val fusedLocationService: FusedLocationService,
    private val androidLocationService: AndroidLocationService
) : RxLocationManager {

    override fun observeLocationChange(): Observable<Location> {
        return createLocationObservable(getDefaultLocationAttributes())
    }

    override fun singleLocation(): Single<Location> {
        return createLocationObservable(getDefaultLocationAttributes())
            .firstOrError()
            .timeout(30, TimeUnit.SECONDS)
    }

    private fun createLocationObservable(locationAttributes: RxLocationAttributes): Observable<Location> {
        return fusedLocationService.requestLocationUpdates(locationAttributes)
            .onErrorResumeNext { it: Throwable ->
                when (it) {
                    is GooglePlayServicesNotAvailableException -> {
                        androidLocationService.requestLocationUpdates(locationAttributes)
                    }
                    else -> Observable.error(it)
                }
            }
            .replay(1)
            .refCount()
    }

    private fun getDefaultLocationAttributes(): RxLocationAttributes {
        return RxLocationAttributes.Builder()
            .setUpdateInterval(10000)
            .setFastestInterval(5000)
            .setPriority(LocationRequest.PRIORITY_HIGH_ACCURACY)
            .setRetryAttempt(3)
            .build()
    }
}
```

Let look into `RxLocationManagerImpl.createLocationObservable` method

```kotlin
private fun createLocationObservable(locationAttributes: RxLocationAttributes): Observable<Location> {
    return fusedLocationService.requestLocationUpdates(locationAttributes)
        .onErrorResumeNext { it: Throwable ->
            when (it) {
                is GooglePlayServicesNotAvailableException -> {
                    androidLocationService.requestLocationUpdates(locationAttributes)
                }
                else -> Observable.error(it)
            }
        }
        .replay(1)
        .refCount()
}
```

First we will observe the location update from `FusedLocationService`, if there is any error occurred, we will switch to observe location change from `AndroidLocationService`. For example, if we run this piece of code in any Chinese devices without Google Play Service, then `AndroidLocationService` will be used.

Next, we apply `replay` and `refCount` operations

```kotlin
fusedLocationService.requestLocationUpdates(locationAttributes)
    .onErrorResumeNext { it: Throwable ->...}
    .replay(1)
    .refCount()
```

- `replay(1)` turn the observable to a `ConnectableObservable`, the latest item will be replay, if any new observer subscribe to the stream.
- `.refCount()` make the `ConnectableObservable` behave like an ordinary Observable. RefCount then keeps track of how many other observers subscribe to it and does not disconnect from the underlying connectable Observable until the last observer has done so.

So, in the end, our target only registers one callback to the API, even multiple observers subscribe to the Observable. And all observers should receive the same locations.

Let move to the `RxLocationManager.singleLocation` method

```kotlin
override fun singleLocation(): Single<Location> {
    return createLocationObservable(getDefaultLocationAttributes())
        .firstOrError()
        .timeout(30, TimeUnit.SECONDS)
}
```

We reuse the observable from `RxLocationManager.observeLocationChange()` method, convert it to a single by calling `Observable.firstOrError()`. For this approach, we will benefit from the caching value from the `observeLocationChange` if there are any observers currently subscribe to the Observable. But the downside is if your app does not actively observe location change, and keep calling the `singleLocation` multiple times. We may consume more battery than expected. Because if there is no observer subscribe to the observable, then every time you call `singleLocation`, we will register the callback to location provides, which high chance will fire our device GPS or other tools.

Secondly, I add the option to set up a location request time out for `singleLocation`. Most of the time we call to get one single location, we expect to get it fast, and possibly there is delaying/hanging on getting the location. For that case, we should fire an error instead of keeping waiting. So, the downstream could show the user an error message.

That it, it's very appreciate that you reach to this point of my post

As mention earlier, the source code is available [here](https://github.com/MinhNguyen-nvm/RxLocation). I create a sample in the repo for you to play with the implementation, it's recommended to check it out.